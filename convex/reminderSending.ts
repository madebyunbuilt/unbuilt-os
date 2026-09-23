'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './lib/functions';
import { sendReminderEmail } from './lib/invoiceEmails';
import { mintPayLink } from './lib/payLinks';
import { reminderWording } from './lib/invoices';

// Emails one payment reminder to the billing contacts, with the invoice's stored PDF attached again.

export const send = internalAction({
  args: { invoiceId: v.id('invoices'), kind: v.string() },
  handler: async (ctx, { invoiceId, kind }): Promise<null> => {
    const data = await ctx.runQuery(internal.billingChase.reminderData, { invoiceId });
    if (!data) return null;
    try {
      const blob = data.pdfStorageId ? await ctx.storage.get(data.pdfStorageId) : null;
      const pdf = blob
        ? { filename: `${data.number}.pdf`, content: new Uint8Array(await blob.arrayBuffer()) }
        : undefined;
      for (const recipient of data.recipients) {
        await sendReminderEmail({
          to: recipient.email,
          contactName: recipient.name,
          number: data.number,
          studioName: data.studioName,
          balance: data.balance,
          dueDate: data.dueDate,
          wording: reminderWording(kind),
          bankAccounts: data.bankAccounts,
          payUrl: await mintPayLink(ctx, invoiceId),
          pdf,
        });
      }
      return null;
    } catch (error) {
      await ctx.runMutation(internal.billingChase.reminderFailed, {
        invoiceId,
        memberId: data.createdByMemberId,
        reason: error instanceof Error ? error.message : 'The reminder could not be sent',
      });
      throw error;
    }
  },
});
