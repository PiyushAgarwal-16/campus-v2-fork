'use client';

import { useEffect, useState } from 'react';
import type { ChatAttachment } from '@campusly/shared-types';
import { mediaApi } from '../lib/media';
import { cn } from '../lib/utils';

/**
 * Renders a chat media attachment (MEDIA_SYSTEM.md §5–8) by fetching a
 * short-lived signed URL on demand. Shows a calm placeholder once the media has
 * expired or been removed — never a broken element.
 */
export function MediaAttachment({
  attachment,
  expired,
  imgClassName,
}: {
  attachment: ChatAttachment;
  expired?: boolean;
  /** Overrides image sizing (e.g. for avatars that fill a fixed circle). */
  imgClassName?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const isExpired =
    expired ||
    (attachment.expiresAt !== null && new Date(attachment.expiresAt).getTime() < Date.now());

  useEffect(() => {
    if (isExpired) return;
    let cancelled = false;
    mediaApi
      .getUrl(attachment.mediaId)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attachment.mediaId, isExpired]);

  if (isExpired || failed) {
    return (
      <span className="block rounded-card border border-dashed border-border px-space-3 py-space-2 text-caption text-muted-foreground">
        {isExpired ? 'This media has expired' : 'Media unavailable'}
      </span>
    );
  }

  if (!url) {
    return <span className="text-caption text-muted-foreground">Loading…</span>;
  }

  if (attachment.kind === 'voice') {
    return <audio controls src={url} className="max-w-full" aria-label="Voice message" />;
  }
  if (attachment.kind === 'video') {
    return <video controls src={url} className="max-h-64 max-w-full rounded-card" />;
  }
  // image / avatar — signed, short-lived object-storage URLs aren't optimizable
  // by next/image (would require static remotePatterns); a plain img is correct.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt="Shared media"
      className={cn('max-h-64 max-w-full rounded-card object-cover', imgClassName)}
      loading="lazy"
    />
  );
}
