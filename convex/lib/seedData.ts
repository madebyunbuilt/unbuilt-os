import { DEFAULT_BUSINESS_CALENDAR } from './businessTime';

// Reference data the seed writes (02-architecture.md, Environments; 09-support-and-sla.md). Changing a value here only
// affects deployments seeded afterwards; the seed never overwrites rows that already exist.

export const DEFAULT_BUSINESS_HOURS = { name: 'Studio hours (Lagos)', ...DEFAULT_BUSINESS_CALENDAR };

/** One business day on the default calendar: 09:00 to 17:00. */
const BUSINESS_DAY_MINUTES = 8 * 60;
const BUSINESS_HOUR_MINUTES = 60;

/** Fixed-date Nigerian public holidays, as MM-DD. */
export const FIXED_HOLIDAYS = [
  { monthDay: '01-01', name: "New Year's Day" },
  { monthDay: '05-01', name: "Workers' Day" },
  { monthDay: '06-12', name: 'Democracy Day' },
  { monthDay: '10-01', name: 'Independence Day' },
  { monthDay: '12-25', name: 'Christmas Day' },
  { monthDay: '12-26', name: 'Boxing Day' },
] as const;

/**
 * Estimated dates for movable holidays. Easter dates are computed; the Islamic holidays depend on the moon sighting and
 * are declared by the Federal Government, so every row is seeded as needing confirmation. Government-declared extra days
 * (for example when a holiday falls at the weekend) are added manually.
 */
export const MOVABLE_HOLIDAY_ESTIMATES: Record<number, readonly { date: string; name: string }[]> = {
  2026: [
    { date: '2026-03-20', name: 'Eid al-Fitr' },
    { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-04-06', name: 'Easter Monday' },
    { date: '2026-05-27', name: 'Eid al-Adha' },
    { date: '2026-08-26', name: 'Mawlid' },
  ],
  2027: [
    { date: '2027-03-10', name: 'Eid al-Fitr' },
    { date: '2027-03-26', name: 'Good Friday' },
    { date: '2027-03-29', name: 'Easter Monday' },
    { date: '2027-05-17', name: 'Eid al-Adha' },
    { date: '2027-08-15', name: 'Mawlid' },
  ],
  2028: [
    { date: '2028-02-27', name: 'Eid al-Fitr' },
    { date: '2028-04-14', name: 'Good Friday' },
    { date: '2028-04-17', name: 'Easter Monday' },
    { date: '2028-05-05', name: 'Eid al-Adha' },
    { date: '2028-08-04', name: 'Mawlid' },
  ],
};

/** The default targets from 09-support-and-sla.md, in business minutes. */
export const DEFAULT_SLA_TARGETS = [
  { priority: 'p1', firstResponseMinutes: 1 * BUSINESS_HOUR_MINUTES, resolutionMinutes: 8 * BUSINESS_HOUR_MINUTES },
  { priority: 'p2', firstResponseMinutes: 4 * BUSINESS_HOUR_MINUTES, resolutionMinutes: 3 * BUSINESS_DAY_MINUTES },
  { priority: 'p3', firstResponseMinutes: 1 * BUSINESS_DAY_MINUTES, resolutionMinutes: 10 * BUSINESS_DAY_MINUTES },
  { priority: 'p4', firstResponseMinutes: 2 * BUSINESS_DAY_MINUTES },
] as const;

/** The three policies 09-support-and-sla.md asks for. They share the default targets until the studio sets final ones. */
export const DEFAULT_SLA_POLICY_NAMES = ['Standard', 'Priority', 'Retainer'] as const;

/** Development-only sample records. Every address is on example.com, so nothing can ever be emailed. */
export const SAMPLE_TEAM = [
  { name: 'Sample Finance', email: 'finance@example.com', roleKey: 'finance', title: 'Finance lead' },
  { name: 'Sample PM', email: 'pm@example.com', roleKey: 'project_manager', title: 'Project manager' },
  { name: 'Sample Designer', email: 'designer@example.com', roleKey: 'member', title: 'Product designer' },
] as const;

export const SAMPLE_CLIENTS = [
  {
    displayName: 'Sample Glossup',
    contacts: [
      { name: 'Ada Sample', email: 'ada@example.com', roleKey: 'client_admin', isBilling: true },
      { name: 'Bayo Sample', email: 'bayo@example.com', roleKey: 'client_member', isBilling: false },
    ],
  },
  {
    displayName: 'Sample Qravit',
    contacts: [{ name: 'Tunde Sample', email: 'tunde@example.com', roleKey: 'client_admin', isBilling: true }],
  },
] as const;
