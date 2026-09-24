import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalMutation, internalQuery, teamMutation } from './lib/functions';
import { getInvoice, invoiceRecipients, OPEN_STATUSES, reminderDue, studioToday } from './lib/invoices';
import { formatMoney } from './lib/money';
import { getOrgSettings } from './lib/settings';
import { getClient } from './lib/crm';
import { notifyTeamMembers } from './lib/notify';

// Chasing (08-billing-and-finance.md, Lifecycle and Reminders). Once a day, at 09:00 Lagos: invoices past their due date
// with money still owed become overdue, and each open invoice gets the reminder due today, if any. A reminder is
// recorded before its email is scheduled, so it is never sent twice.

const longDate = (value: string) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(Date.parse(`${value}T00:00:00Z`));

export const dailyRun = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ overdue: number; reminders: number }> => {
    const today = await studioToday(ctx);
    let overdue = 0;
    let reminders = 0;
    for (const status of OPEN_STATUSES) {
      const invoices = await ctx.db
        .query('invoices')
        .withIndex('by_status_due', (q) => q.eq('status', status))
        .collect();
      for (const invoice of invoices) {
        if (!invoice.dueDate || invoice.balanceMinor === 0) continue;
        if (invoice.dueDate < today && invoice.status !== 'overdue') {
          await ctx.db.patch('invoices', invoice._id, { status: 'overdue' });
          overdue++;
        }
        if (invoice.noReminders) continue;
        const client = await ctx.db.get('clients', invoice.clientId);
        if (!client || client.noReminders) continue;
        const kind = reminderDue(
          invoice.dueDate,
          today,
          invoice.reminders.map((reminder) => reminder.kind),
        );
        if (!kind) continue;
        await ctx.db.patch('invoices', invoice._id, {
          reminders: [...invoice.reminders, { kind, sentAt: Date.now() }],
        });
        await ctx.scheduler.runAfter(0, internal.reminderSending.send, { invoiceId: invoice._id, kind });
        reminders++;
      }
    }
    return { overdue, reminders };
  },
});

/** What a reminder email needs: who it goes to, what is owed, and the stored PDF to attach. */
export const reminderData = internalQuery({
  args: { invoiceId: v.id('invoices') },
  handler: async (ctx, { invoiceId }) => {
    const invoice = await ctx.db.get('invoices', invoiceId);
    // Paid, voided or written off since the run: nothing to chase.
    if (!invoice || !OPEN_STATUSES.has(invoice.status) || invoice.balanceMinor === 0 || !invoice.dueDate) return null;
    const settings = await getOrgSettings(ctx);
    const pdf = invoice.pdfFileId ? await ctx.db.get('files', invoice.pdfFileId) : null;
    return {
      number: invoice.number ?? '',
      studioName: settings.legalName ?? settings.tradingName ?? 'Unbuilt Studio',
      balance: formatMoney(invoice.balanceMinor, invoice.currency),
      dueDate: longDate(invoice.dueDate),
      recipients: await invoiceRecipients(ctx, invoice.clientId, invoice.recipientContactIds),
      bankAccounts: settings.bankAccounts
        .filter((account) => account.currency === invoice.currency)
        .map(({ bankName, accountName, accountNumber, swift, iban }) => ({
          bankName,
          accountName,
          accountNumber,
          swift,
          iban,
        })),
      pdfStorageId: pdf?.storageId,
      createdByMemberId: invoice.createdByMemberId,
    };
  },
});

export const reminderFailed = internalMutation({
  args: { invoiceId: v.id('invoices'), memberId: v.id('teamMembers'), reason: v.string() },
  handler: async (ctx, { invoiceId, memberId, reason }) => {
    const invoice = await ctx.db.get('invoices', invoiceId);
    await notifyTeamMembers(ctx, [memberId], {
      event: 'invoice_reminder_failed',
      title: `A reminder for ${invoice?.number ?? 'an invoice'} did not go out`,
      body: reason.slice(0, 300),
      link: `/billing/invoices/${invoiceId}`,
    });
  },
});

/** Turns reminders off, or back on, for one invoice. */
export const setInvoiceReminders = teamMutation('invoices.update')({
  args: { invoiceId: v.id('invoices'), off: v.boolean() },
  handler: async (ctx, { invoiceId, off }) => {
    await getInvoice(ctx, invoiceId);
    await ctx.db.patch('invoices', invoiceId, { noReminders: off });
  },
});

/** Turns reminders off, or back on, for every invoice to one client. */
export const setClientReminders = teamMutation('invoices.update')({
  args: { clientId: v.id('clients'), off: v.boolean() },
  handler: async (ctx, { clientId, off }) => {
    await getClient(ctx, clientId);
    await ctx.db.patch('clients', clientId, { noReminders: off });
  },
});
