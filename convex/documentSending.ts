'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { sendDocumentEmail } from './lib/documentEmails';
import { internalAction } from './lib/functions';
import { renderDocumentPdf } from './lib/renderDocumentPdf';

// Sending a document (07-documents-and-esign.md, Send). The order is the one set out there: snapshot the version, render
// the PDF, store it with its hash, assign the number on the first send, then email the client. Each database step is its
// own mutation, so a failed render leaves a version that can be sent again rather than a document that claims to have
// gone out. documents.send checks the permission and schedules this, and the studio is told if it fails.

export const send = internalAction({
  args: {
    documentId: v.id('documents'),
    memberId: v.id('teamMembers'),
    contactIds: v.optional(v.array(v.id('contacts'))),
    message: v.optional(v.string()),
    changeNote: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    try {
      const prepared = await ctx.runMutation(internal.documents.prepareSend, {
        documentId: args.documentId,
        contactIds: args.contactIds,
        changeNote: args.changeNote,
        memberId: args.memberId,
      });

      const pdf = await renderDocumentPdf(prepared.pdf);
      const storageId = await ctx.storage.store(new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }));

      const stored = await ctx.runMutation(internal.documents.attachPdf, {
        documentId: args.documentId,
        version: prepared.version,
        storageId: storageId as Id<'_storage'>,
        fileName: `${prepared.number}.pdf`,
        memberId: args.memberId,
        // Kept so the signed copy can be drawn again, identically, with the signatures on their lines.
        pdfPayload: JSON.stringify(prepared.pdf),
      });
      if (!stored.ok) throw new Error(stored.message);

      const emailed: string[] = [];
      for (const recipient of prepared.recipients) {
        await sendDocumentEmail({
          to: recipient.email,
          contactName: recipient.name,
          documentTitle: prepared.title,
          documentNumber: prepared.number,
          typeLabel: prepared.typeLabel,
          studioName: prepared.studioName,
          senderName: prepared.senderName,
          message: args.message,
          portalUrl: prepared.portalUrl,
          validUntil: prepared.validUntilLabel,
        });
        emailed.push(recipient.email);
      }

      await ctx.runMutation(internal.documents.markSent, {
        documentId: args.documentId,
        version: prepared.version,
        emailed,
      });
      return null;
    } catch (error) {
      // The document keeps the status it had. Whoever pressed send has to know, so they can put it right and try again.
      await ctx.runMutation(internal.documents.reportSendFailed, {
        documentId: args.documentId,
        memberId: args.memberId,
        reason: error instanceof Error ? error.message : 'The document could not be sent',
      });
      throw error;
    }
  },
});
