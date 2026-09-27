'use client';

import { useMutation, useQuery } from 'convex/react';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { groupByDay } from '@/lib/notification-groups';
import { type Surface } from '@/lib/surface';
import { cn } from '@/lib/utils';

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

const UNREAD_CAP = 99;

export function NotificationsBell({ surface }: { surface: Surface }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  const result = useQuery(surface === 'team' ? api.notifications.teamList : api.notifications.portalList);
  const markRead = useMutation(surface === 'team' ? api.notifications.teamMarkRead : api.notifications.portalMarkRead);
  const markAllRead = useMutation(
    surface === 'team' ? api.notifications.teamMarkAllRead : api.notifications.portalMarkAllRead,
  );

  const unreadCount = result?.unreadCount ?? 0;
  const badge = unreadCount > UNREAD_CAP ? `${UNREAD_CAP}+` : String(unreadCount);
  const groups = useMemo(
    () =>
      groupByDay(result?.items ?? [], {
        // eslint-disable-next-line react-hooks/purity -- grouping is relative to when the list renders
        now: Date.now(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    [result?.items],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unreadCount > 0 ? `Notifications, ${badge} unread` : 'Notifications'}
        >
          <Bell className="size-5" aria-hidden />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute -top-0.5 -right-0.5 min-w-4.5 rounded-full bg-attention px-1 text-center text-[0.6875rem] leading-4.5 font-semibold text-attention-foreground"
            >
              {badge}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-display text-base font-bold">Notifications</h2>
          <Button
            variant="link"
            className="h-auto p-0 text-sm"
            disabled={unreadCount === 0}
            onClick={() => void markAllRead({})}
          >
            Mark all read
          </Button>
        </div>
        <div className="max-h-[min(28rem,70vh)] overflow-y-auto overscroll-contain">
          {result === undefined ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
          ) : groups.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Nothing yet. Updates about your work appear here.</p>
          ) : (
            groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h3 className="bg-muted px-4 py-1.5 text-xs font-semibold text-muted-foreground">{group.label}</h3>
                <ul>
                  {group.items.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-accent',
                          !item.read && 'bg-accent/40',
                        )}
                        onClick={() => {
                          if (!item.read) void markRead({ notificationId: item.id as Id<'notifications'> });
                          if (item.link) go(item.link);
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
                          <span className="block text-sm font-medium">
                            {!item.read && <span className="sr-only">Unread: </span>}
                            {item.title}
                          </span>
                          <span className="mt-0.5 block text-sm text-muted-foreground">{item.body}</span>
                        </span>
                        {/* The day is in the heading above; this says when within it, which is what tells two
                            notifications about the same ticket apart. */}
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {time.format(item.createdAt)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className="border-t px-4 py-2 text-center">
          <Button variant="link" className="h-auto p-0 text-sm" onClick={() => go('/notifications')}>
            See all notifications
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
