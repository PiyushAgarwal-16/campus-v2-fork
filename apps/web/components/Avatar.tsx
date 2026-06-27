'use client';

import { MediaAttachment } from './MediaAttachment';
import { cn } from '../lib/utils';

/**
 * A circular user avatar (UI_GUIDELINES.md §12). Renders the signed media image
 * when an avatar is set, otherwise a calm initial fallback. Sizes map to the
 * 8-point scale.
 */
export function Avatar({
  name,
  mediaId,
  size = 'md',
  className,
}: {
  name: string;
  mediaId: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const dim = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-16 w-16' : 'h-10 w-10';
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-surface',
        dim,
        className,
      )}
    >
      {mediaId ? (
        <MediaAttachment
          attachment={{
            mediaId,
            kind: 'avatar',
            mimeType: 'image/*',
            durationMs: null,
            expiresAt: null,
          }}
          imgClassName="h-full w-full rounded-none object-cover"
        />
      ) : (
        <span className="text-body font-medium text-muted-foreground">
          {name.charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}
