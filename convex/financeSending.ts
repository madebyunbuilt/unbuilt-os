'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { sendFinanceEmail } from './lib/financeEmails';
import { internalAction } from './lib/functions';
import { renderCreditNotePdf, renderReceiptPdf } from './lib/renderDocumentPdf';

// Renders a receipt or credit note, stores it on its record, and emails the billing contacts. The money was recorded
// before this runs, so a failure here only leaves the PDF or email missing; whoever recorded it is told.

export const sendReceipt = internalAction({
  args: { receiptId: v.id('receipts'), memberId: v.id('teamMembers') },
  handler: async (ctx, { receiptId, memberId }): Promise<null> => {
    try {
      const data = await ctx.runQuery(internal.financeDocuments.receiptData, { receiptId });
      if (!data) return null;
      const pdf = new Uint8Array(await renderReceiptPdf(data.pdf));
      const storageId = await ctx.storage.store(new Blob([pdf], { type: 'application/pdf' }));
      const stored = await ctx.runMutation(internal.financeDocuments.attachPdf, {
        receiptId,
        storageId,
        fileName: `${data.number}.pdf`,
        memberId,
      });
      if (!stored.ok) throw new Error(stored.message);
      if (!data.email) return null;
      for (const recipient of data.recipients) {
        await sendFinanceEmail({
          to: recipient.email,
          contactName: recipient.name,
          kind: 'Receipt',
          number: data.number,
          studioName: data.studioName,
          summary: data.summary,
          pdf: { filename: `${data.number}.pdf`, content: pdf },
        });
      }
      await ctx.runMutation(internal.financeDocuments.markEmailed, { receiptId });
      return null;
    } catch (error) {
      await ctx.runMutation(internal.financeDocuments.reportFailed, {
        memberId,
        what: 'A receipt',
        reason: error instanceof Error ? error.message : 'It could not be made',
      });
      throw error;
    }
  },
});

export const sendCreditNote = internalAction({
  args: { creditNoteId: v.id('creditNotes'), memberId: v.id('teamMembers'), email: v.boolean() },
  handler: async (ctx, { creditNoteId, memberId, email }): Promise<null> => {
    try {
      const data = await ctx.runQuery(internal.financeDocuments.creditNoteData, { creditNoteId });
      if (!data) return null;
      const pdf = new Uint8Array(await renderCreditNotePdf(data.pdf));
      const storageId = await ctx.storage.store(new Blob([pdf], { type: 'application/pdf' }));
      const stored = await ctx.runMutation(internal.financeDocuments.attachPdf, {
        creditNoteId,
        storageId,
        fileName: `${data.number}.pdf`,
        memberId,
      });
      if (!stored.ok) throw new Error(stored.message);
      if (!email) return null;
      for (const recipient of data.recipients) {
        await sendFinanceEmail({
          to: recipient.email,
          contactName: recipient.name,
          kind: 'Credit note',
          number: data.number,
          studioName: data.studioName,
          summary: data.summary,
          pdf: { filename: `${data.number}.pdf`, content: pdf },
        });
      }
      await ctx.runMutation(internal.financeDocuments.markEmailed, { creditNoteId });
      return null;
    } catch (error) {
      await ctx.runMutation(internal.financeDocuments.reportFailed, {
        memberId,
        what: 'A credit note',
        reason: error instanceof Error ? error.message : 'It could not be made',
      });
      throw error;
    }
  },
});
