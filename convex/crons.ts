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

export default crons;
