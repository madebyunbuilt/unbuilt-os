import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// 03:00 Lagos (02:00 UTC), when nobody is uploading.
crons.daily('delete abandoned uploads', { hourUTC: 2, minuteUTC: 0 }, internal.files.cleanupOrphanUploads, {});

// 2 January, 09:00 Lagos: add the year's standard holidays and ask admins to confirm the movable ones.
crons.cron('confirm public holidays', '0 8 2 1 *', internal.holidays.januaryReminder, {});

// 04:00 Lagos: forget activity from sessions that are long idle or gone.
crons.daily('clear old session activity', { hourUTC: 3, minuteUTC: 0 }, internal.sessionActivity.cleanup, {});

// 17:00 Lagos: remind deal owners of missed follow-ups and deals gone quiet.
crons.daily('deal follow-up reminders', { hourUTC: 16, minuteUTC: 0 }, internal.deals.sendFollowUpReminders, {});

// 06:00 Lagos: mark quotes and proposals whose date has passed, and tell whoever drafted them.
crons.daily('expire quotes and proposals', { hourUTC: 5, minuteUTC: 0 }, internal.documents.expireOverdue, {});

// 04:30 Lagos: forget old rate-limit windows for public endpoints.
crons.daily('clear old rate limits', { hourUTC: 3, minuteUTC: 30 }, internal.enquiries.cleanupRateLimits, {});

// 09:00 Lagos: remind signers who have not signed yet (3 and 7 days in, and the day before the link expires).
crons.daily('signing reminders', { hourUTC: 8, minuteUTC: 0 }, internal.signatures.sendReminders, {});

// Hourly: close signing requests whose date has passed, so an expired link stops working on time.
crons.hourly('expire signing requests', { minuteUTC: 15 }, internal.signatures.expireRequests, {});

// 09:00 Lagos: mark invoices past due as overdue and send the payment reminders due today.
crons.daily('invoice reminders', { hourUTC: 8, minuteUTC: 0 }, internal.billingChase.dailyRun, {});

// 07:00 Lagos: raise the invoices for billing schedule items whose date has come, before the day's work starts.
crons.daily('scheduled billing', { hourUTC: 6, minuteUTC: 0 }, internal.billingSchedules.invoiceDueItems, {});

// 07:15 Lagos: roll retainers whose period has ended onto the next one, and send the hours-used alerts.
crons.daily('retainer periods', { hourUTC: 6, minuteUTC: 15 }, internal.retainers.runDue, {});

// 09:30 Lagos, after the overdue marking: raise this month's late fee on invoices still unpaid past their grace period.
crons.daily('late fees', { hourUTC: 8, minuteUTC: 30 }, internal.lateFees.runDue, {});

// 08:00 Lagos: tell whoever pays about the bills due this week, and any already late.
crons.daily('bills due', { hourUTC: 7, minuteUTC: 0 }, internal.bills.remindDue, {});

// Every quarter hour: warn on tickets three-quarters of the way through an SLA target, and on the ones that have gone
// past it. A P1 has one business hour to be answered, so anything slower than this would warn too late to help.
crons.interval('sla warnings', { minutes: 15 }, internal.slaAlerts.runDue, {});

// 07:30 Lagos on the 1st: last month's SLA reports, waiting for somebody to read before they go to a client. A month
// that ends on a weekend simply means the reports sit a day or two before anybody opens them.
crons.cron('monthly sla reports', '30 6 1 * *', internal.slaReports.generateMonthly, {});

// 09:00 Lagos: nudge whoever holds SLA about a report a client is still waiting for.
crons.daily('unsent sla reports', { hourUTC: 8, minuteUTC: 45 }, internal.slaReports.remindUnsent, {});

// Every minute: fetch whatever monitor is due. The interval on each monitor decides how often it is actually checked;
// this only decides how finely that interval can be kept.
crons.interval('uptime checks', { minutes: 1 }, internal.monitors.runDue, {});

// 03:30 Lagos: forget check history past the 90 days 09-support-and-sla.md keeps it for.
crons.daily('forget old uptime checks', { hourUTC: 2, minuteUTC: 30 }, internal.monitors.forgetOldChecks, {});

// 08:15 Lagos: renewal reminders at 60, 30, 14 and 7 days, and the invoice autoInvoice drafts from 30 days out.
crons.daily('renewal reminders', { hourUTC: 7, minuteUTC: 15 }, internal.assets.remindRenewals, {});

// 09:15 Lagos: anything past its renewal date that nobody has said is renewed. A lapsed domain gets worse each day.
crons.daily('overdue renewals', { hourUTC: 8, minuteUTC: 15 }, internal.assets.alertOverdue, {});

// 08:45 Lagos: vault items due to be rotated, seven days before the date and on it.
crons.daily('vault rotation reminders', { hourUTC: 7, minuteUTC: 45 }, internal.vaultData.sendRotationReminders, {});

export default crons;
