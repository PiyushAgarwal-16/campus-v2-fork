'use client';

import { useEffect, useState } from 'react';
import type { ChatAttachment } from '@campusly/shared-types';
import { mediaApi } from '../lib/media';
import { cn } from '../lib/utils';
import { Eye, X } from 'lucide-react';

/**
 * Renders a chat media attachment (MEDIA_SYSTEM.md §5–8) by fetching a
 * short-lived signed URL on demand. Shows a calm placeholder once the media has
 * expired or been removed — never a broken element.
 */
export function MediaAttachment({
  attachment,
  expired,
  imgClassName,
  context = 'chat',
}: {
  attachment: ChatAttachment;
  expired?: boolean;
  /** Overrides image sizing (e.g. for avatars that fill a fixed circle). */
  imgClassName?: string;
  /** 'chat' = blur + lightbox + expiry. 'wall' = direct display, no expiry. */
  context?: 'chat' | 'wall';
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showLightbox, setShowLightbox] = useState(false);

  const isExpired =
    context === 'chat' &&
    (expired ||
      (attachment.expiresAt !== null && new Date(attachment.expiresAt).getTime() < Date.now()));

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

  // Calculate dynamic expiry text
  let expiryText = 'photo will expire in 2 days'; // default fallback
  if (attachment.expiresAt) {
    const diffMs = new Date(attachment.expiresAt).getTime() - Date.now();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays > 0) {
      expiryText = `photo will expire in ${diffDays} day${diffDays > 1 ? 's' : ''}`;
    } else {
      const diffHours = Math.ceil(diffMs / (1000 * 60 * 60));
      if (diffHours > 0) {
        expiryText = `photo will expire in ${diffHours} hour${diffHours > 1 ? 's' : ''}`;
      } else {
        expiryText = 'photo expires soon';
      }
    }
  }

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
    if (context === 'wall') {
      return (
        <video
          controls
          src={url}
          className={cn('w-full h-auto max-h-[75vh] object-contain bg-black/90', imgClassName)}
        />
      );
    }
    return <video controls src={url} className="max-h-64 max-w-full rounded-card" />;
  }

  // Handle images
  if (attachment.kind === 'image') {
    // Wall context — render clean, no blur, no expiry, full size, edge-to-edge
    if (context === 'wall') {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt="Shared media"
          className={cn('w-full h-auto max-h-[75vh] object-contain bg-muted/10', imgClassName)}
          loading="lazy"
        />
      );
    }

    // Chat context — blur + lightbox + expiry
    return (
      <>
        <div
          onClick={() => setShowLightbox(true)}
          className="relative max-h-64 overflow-hidden rounded-card cursor-pointer group select-none flex items-center justify-center bg-black/10"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt="Shared media"
            className={cn(
              'max-h-64 w-full object-cover transition-all duration-300 blur-2xl scale-105',
              imgClassName,
            )}
            loading="lazy"
          />

          {/* Blur Overlay */}
          <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2 p-4 text-center">
            <Eye className="h-6 w-6 text-white/90 animate-pulse" />
            <span className="text-small font-semibold text-white">Tap to view photo</span>
            <span className="text-caption text-white/70 font-mono">{expiryText}</span>
          </div>
        </div>

        {/* Full screen Lightbox overlay */}
        {showLightbox && (
          <div className="fixed inset-0 bg-black/95 z-[999] flex flex-col items-center justify-center p-space-6 select-none animate-in fade-in duration-200">
            {/* Click backdrop to close */}
            <div className="absolute inset-0" onClick={() => setShowLightbox(false)} />

            {/* Close Button */}
            <button
              type="button"
              onClick={() => setShowLightbox(false)}
              className="absolute top-space-6 right-space-6 z-50 text-white/80 hover:text-white transition-colors bg-white/10 hover:bg-white/20 p-2 rounded-full"
              aria-label="Close image viewer"
            >
              <X className="h-6 w-6" />
            </button>

            {/* Clear unblurred full-size image */}
            <div className="relative z-10 max-h-[80vh] max-w-full flex items-center justify-center animate-in zoom-in-95 duration-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="Revealed shared media"
                className="max-h-[80vh] max-w-full rounded-2xl object-contain shadow-2xl border border-white/5"
              />
            </div>

            {/* Bottom Expiration Notice */}
            <div className="relative z-10 mt-space-6 bg-white/10 px-4 py-1.5 rounded-full border border-white/5 backdrop-blur-sm">
              <span className="text-caption text-white/90 font-mono uppercase tracking-wider text-[11px]">
                {expiryText}
              </span>
            </div>
          </div>
        )}
      </>
    );
  }

  // Default fallback (e.g. avatars) — no blur
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
