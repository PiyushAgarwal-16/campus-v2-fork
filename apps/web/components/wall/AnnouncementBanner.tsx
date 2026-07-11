'use client';

import { Megaphone, X } from 'lucide-react';
import { useAnnouncements } from '../../hooks/useAnnouncements';
import { cn } from '../../lib/utils';

/**
 * Wall announcement banner (ADMIN_PANEL.md §9). Renders the active campus /
 * platform announcements at the top of the Campus Wall as dismissible cards.
 * Live updates arrive over the socket; dismissals persist per device. Renders
 * nothing when there is no active, undismissed announcement.
 */
export function AnnouncementBanner({ className }: { className?: string }) {
  const { announcements, dismiss } = useAnnouncements();

  if (announcements.length === 0) return null;

  return (
    <div className={cn('flex flex-col gap-space-2 px-space-4 pt-space-2', className)}>
      {announcements.map((a) => (
        <div
          key={a.id}
          role="status"
          className="flex items-start gap-space-3 rounded-card border border-brand/30 bg-brand/10 px-space-4 py-space-3"
        >
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand"
            aria-hidden="true"
          >
            <Megaphone className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-body font-semibold text-foreground">{a.title}</span>
            <span className="text-caption text-muted-foreground break-words">{a.body}</span>
          </div>
          <button
            type="button"
            onClick={() => dismiss(a.id)}
            aria-label={`Dismiss announcement: ${a.title}`}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-button text-muted-foreground transition-colors hover:bg-brand/15 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
