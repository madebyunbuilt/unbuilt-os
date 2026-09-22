'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { sendInvoiceEmail } from './lib/invoiceEmails';
import { internalAction } from './lib/functions';
import { formatMoney } from './lib/money';
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
