'use client';

import { useEffect } from 'react';
import type { NotificationType } from '@campusly/shared-types';
import {
  Bell,
  UserPlus,
  UserCheck,
  MessageCircle,
  Heart,
  Megaphone,
  ShieldAlert,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { useNotifications } from '../../hooks/useNotifications';
import { AppNav } from '../../components/AppNav';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';

/**
 * Notifications screen (NOTIFICATION_SYSTEM.md, UI_GUIDELINES.md). Lists the
 * caller's notifications newest-first, with a per-type icon and relative time.
 * Opening the screen marks everything read (clears the nav badge).
 */

const TYPE_ICON: Record<NotificationType, LucideIcon> = {
  friend_request: UserPlus,
  friend_accepted: UserCheck,
  match: Sparkles,
  message: MessageCircle,
  wall_reply: MessageCircle,
  wall_reaction: Heart,
  community: Megaphone,
  announcement: Megaphone,
  moderation: ShieldAlert,
  system: Bell,
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NotificationsPage() {
  const { user, isLoading } = useRequireAuth();
  const { items, nextCursor, loading, loadFirst, loadMore, markAllRead } = useNotifications();

  // Load the list and mark everything read on open.
  useEffect(() => {
    if (!user) return;
    void loadFirst().then(() => void markAllRead());
  }, [user, loadFirst, markAllRead]);

  if (isLoading || !user) return null;

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppNav />

      <main className="mx-auto w-full max-w-xl flex-1 px-space-4 py-space-5 pb-24 md:pb-space-5">
        <div className="mb-space-5 flex items-center justify-between gap-space-2">
          <h1 className="text-h1 text-foreground">Notifications</h1>
          {items.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => void markAllRead()}>
              Mark all read
            </Button>
          )}
        </div>

        {loading && items.length === 0 ? (
          <div className="flex flex-col divide-y divide-border/40">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-space-3 py-space-4">
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-muted" />
                <div className="flex flex-1 flex-col gap-space-2">
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-space-2 py-space-16 text-center text-muted-foreground select-none">
            <Bell className="h-8 w-8" />
            <span className="text-body font-medium text-foreground">No notifications yet</span>
            <span className="text-caption">
              Likes, replies, and friend requests will show up here.
            </span>
          </div>
        ) : (
          <>
            <ul className="flex flex-col divide-y divide-border/40">
              {items.map((n) => {
                const Icon = TYPE_ICON[n.type] ?? Bell;
                return (
                  <li
                    key={n.id}
                    className={cn(
                      'flex items-start gap-space-3 py-space-4',
                      !n.isRead && 'bg-brand/[0.04]',
                    )}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-body font-medium text-foreground">{n.title}</span>
                      {n.body && (
                        <span className="text-caption text-muted-foreground break-words">
                          {n.body}
                        </span>
                      )}
                      <span className="text-small text-muted-foreground">
                        {relativeTime(n.createdAt)}
                      </span>
                    </div>
                    {!n.isRead && (
                      <span className="mt-space-1 h-2 w-2 shrink-0 rounded-full bg-brand" />
                    )}
                  </li>
                );
              })}
            </ul>

            {nextCursor && (
              <div className="flex justify-center pt-space-5">
                <Button variant="secondary" size="sm" onClick={() => void loadMore()}>
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
