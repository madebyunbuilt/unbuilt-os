// Notifications grouped by day in the viewer's timezone (14-platform.md: a list grouped by day).

export type DayGroup<T> = { label: string; items: T[] };

function dayKey(timestamp: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    timestamp,
  );
}

export function groupByDay<T extends { createdAt: number }>(
  items: readonly T[],
  { now, timeZone, locale = 'en-GB' }: { now: number; timeZone: string; locale?: string },
): DayGroup<T>[] {
  const today = dayKey(now, timeZone);
  const yesterday = dayKey(now - 24 * 60 * 60 * 1000, timeZone);
  const groups = new Map<string, DayGroup<T>>();

  for (const item of items) {
    const key = dayKey(item.createdAt, timeZone);
    let group = groups.get(key);
    if (!group) {
      const label =
        key === today
          ? 'Today'
          : key === yesterday
            ? 'Yesterday'
            : new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(
                item.createdAt,
              );
      group = { label, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  return [...groups.values()];
}
