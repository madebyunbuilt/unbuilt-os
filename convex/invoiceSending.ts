'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { sendInvoiceEmail } from './lib/invoiceEmails';
import { internalAction } from './lib/functions';
import { formatMoney } from './lib/money';
import { mintPayLink } from './lib/payLinks';
import { renderInvoicePdf } from './lib/renderDocumentPdf';

// Sending an invoice (08-billing-and-finance.md, Invoices, Send): number it, freeze its lines, totals and rate, render
// the PDF and store it with its hash, then email the billing contacts with the PDF. Each database step is its own
// mutation, so a failed render or email leaves a draft that can be sent again, keeping its number. invoices.send
// checks the permission and schedules this; whoever pressed send is told if it fails. The pay link and the Paystack
// transaction join this with online payments (step 8).

export const send = internalAction({
  args: {
    invoiceId: v.id('invoices'),
    memberId: v.id('teamMembers'),
    contactIds: v.optional(v.array(v.id('contacts'))),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    try {
      const prepared = await ctx.runMutation(internal.invoices.prepareSend, {
        invoiceId: args.invoiceId,
        memberId: args.memberId,
        contactIds: args.contactIds,
      });

      const pdf = new Uint8Array(await renderInvoicePdf(prepared.pdf));
      const payUrl = await mintPayLink(ctx, args.invoiceId);
      const storageId = await ctx.storage.store(new Blob([pdf], { type: 'application/pdf' }));
      const stored = await ctx.runMutation(internal.invoices.attachPdf, {
        invoiceId: args.invoiceId,
        storageId,
        fileName: `${prepared.number}.pdf`,
        memberId: args.memberId,
      });
      if (!stored.ok) throw new Error(stored.message);

      for (const recipient of prepared.recipients) {
        await sendInvoiceEmail({
          to: recipient.email,
          contactName: recipient.name,
          number: prepared.number,
          typeLabel: prepared.typeLabel,
          studioName: prepared.studioName,
          senderName: prepared.senderName,
          amount: formatMoney(prepared.totalMinor, prepared.currency),
          dueDate: prepared.dueDate,
          message: args.message,
          whtNote: prepared.whtNote,
          payUrl,
          bankAccounts: prepared.bankAccounts,
          pdf: { filename: `${prepared.number}.pdf`, content: pdf },
        });
      }

      await ctx.runMutation(internal.invoices.markSent, {
        invoiceId: args.invoiceId,
        memberId: args.memberId,
        recipientContactIds: prepared.recipients.map((recipient) => recipient.id),
      });
      return null;
    } catch (error) {
      await ctx.runMutation(internal.invoices.reportSendFailed, {
        invoiceId: args.invoiceId,
        memberId: args.memberId,
        reason: error instanceof Error ? error.message : 'The invoice could not be sent',
      });
      throw error;
    }
  },
});

/**
 * The same invoice emailed again (08-billing-and-finance.md, Sending again). Nothing is numbered and nothing is
 * rendered: the PDF the client already has is fetched from storage and sent once more, with the pay link the invoice
 * has always had. A failure tells whoever pressed send, and the invoice is untouched either way.
 */
export const sendAgain = internalAction({
  args: {
    invoiceId: v.id('invoices'),
    memberId: v.id('teamMembers'),
    contactIds: v.array(v.id('contacts')),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    try {
      const data = await ctx.runQuery(internal.invoices.resendData, {
        invoiceId: args.invoiceId,
        contactIds: args.contactIds,
        memberId: args.memberId,
      });
      if (!data) throw new Error('There is no stored PDF for this invoice to send again');
      const blob = await ctx.storage.get(data.pdfStorageId);
      if (!blob) throw new Error(`The stored PDF for ${data.number} could not be read`);
      const pdf = { filename: `${data.number}.pdf`, content: new Uint8Array(await blob.arrayBuffer()) };
      const payUrl = await mintPayLink(ctx, args.invoiceId);

      for (const recipient of data.recipients) {
        await sendInvoiceEmail({
          to: recipient.email,
          contactName: recipient.name,
          number: data.number,
          typeLabel: data.typeLabel,
          studioName: data.studioName,
          senderName: data.senderName,
          amount: data.amount,
          dueDate: data.dueDate,
          message: args.message,
          whtNote: data.whtNote,
          payUrl,
          bankAccounts: data.bankAccounts,
          copyOfDate: data.sentOn,
          pdf,
        });
      }

      await ctx.runMutation(internal.invoices.markSentAgain, {
        invoiceId: args.invoiceId,
        memberId: args.memberId,
        recipientContactIds: data.recipients.map((recipient) => recipient.id),
      });
      return null;
    } catch (error) {
      await ctx.runMutation(internal.invoices.reportSendFailed, {
        invoiceId: args.invoiceId,
        memberId: args.memberId,
        reason: error instanceof Error ? error.message : 'The invoice could not be sent again',
      });
      throw error;
    }
  },
});
