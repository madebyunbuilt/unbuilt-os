import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// 03:00 Lagos (02:00 UTC), when nobody is uploading.
crons.daily('delete abandoned uploads', { hourUTC: 2, minuteUTC: 0 }, internal.files.cleanupOrphanUploads, {});

// 2 January, 09:00 Lagos: add the year's standard holidays and ask admins to confirm the movable ones.
crons.cron('confirm public holidays', '0 8 2 1 *', internal.holidays.januaryReminder, {});

export default crons;
