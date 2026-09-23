'use client';

import { useMutation, useQuery } from 'convex/react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { groupByDay } from '@/lib/notification-groups';
import { type Surface } from '@/lib/surface';
import { cn } from '@/lib/utils';

// Every notification, for catching up (14-platform.md, Notifications). The bell is for a glance; this is the whole
// list, grouped by day, with the unread on their own when wanted.

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function NotificationsPage({ surface }: { surface: Surface }) {
  const router = useRouter();
  const team = surface === 'team';
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [before, setBefore] = useState<number | undefined>(undefined);
  const [older, setOlder] = useState<
    { id: string; title: string; body?: string; link?: string; read: boolean; createdAt: number }[]
  >([]);
  const result = useQuery(team ? api.notifications.teamFeed : api.notifications.portalFeed, { before, unreadOnly });
  const markRead = useMutation(team ? api.notifications.teamMarkRead : api.notifications.portalMarkRead);
  const markAllRead = useMutation(team ? api.notifications.teamMarkAllRead : api.notifications.portalMarkAllRead);

  const items = useMemo(() => [...older, ...(result?.items ?? [])], [older, result?.items]);
  const groups = useMemo(
    () =>
      groupByDay(items, {
        // eslint-disable-next-line react-hooks/purity -- grouping is relative to when the list renders
        now: Date.now(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    [items],
  );
  const show = (next: boolean) => {
    setUnreadOnly(next);
    setBefore(undefined);
    setOlder([]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-bold">Notifications</h1>
        <div className="flex gap-1" role="group" aria-label="Which notifications">
          {[
            { label: 'Everything', value: false },
            { label: `Unread${result?.unreadCount ? ` (${result.unreadCount})` : ''}`, value: true },
          ].map((option) => (
            <Button
              key={option.label}
              variant={unreadOnly === option.value ? 'default' : 'outline'}
              size="sm"
              aria-pressed={unreadOnly === option.value}
              onClick={() => show(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="sm:ml-auto"
          disabled={!result?.unreadCount}
          onClick={() => void markAllRead({})}
        >
          Mark all read
        </Button>
      </div>

      {result === undefined ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          {unreadOnly ? 'Nothing unread.' : 'Nothing yet. Updates about your work appear here.'}
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="space-y-2">
              <h2 className="text-sm font-semibold text-muted-foreground">{group.label}</h2>
              <ul className="divide-y rounded-lg border">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={cn(
                        'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent',
                        !item.read && 'bg-accent/40',
                      )}
                      onClick={() => {
                        if (!item.read) void markRead({ notificationId: item.id as Id<'notifications'> });
                        if (item.link) router.push(item.link);
                      }}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'mt-1.5 size-2 shrink-0 rounded-full',
                          item.read ? 'bg-transparent' : 'bg-attention',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">
                          {!item.read && <span className="sr-only">Unread: </span>}
                          {item.title}
                        </span>
                        {item.body && <span className="mt-0.5 block text-sm text-muted-foreground">{item.body}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">{time.format(item.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {result?.nextBefore !== undefined && (
        <Button
          variant="outline"
          onClick={() => {
            setOlder(items);
            setBefore(result.nextBefore);
          }}
        >
          Show older
        </Button>
      )}
    </div>
  );
}
