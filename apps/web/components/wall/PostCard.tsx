'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WallPost } from '@campusly/shared-types';
import { Heart, MessageCircle, Bookmark, Flag, Trash2, MoreHorizontal } from 'lucide-react';
import { wallApi } from '../../lib/wall';
import { MediaAttachment } from '../MediaAttachment';
import { Avatar } from '../Avatar';
import { cn } from '../../lib/utils';

/**
 * A single wall post rendered as a continuous, Instagram-style feed item
 * (PUBLIC_WALL.md §6): flush to the column with a divider between posts, an
 * edge-to-edge media band, and a supportive action row (no clout scores).
 */
export function PostCard({
  post: initial,
  onDeleted,
  showReplyLink = true,
}: {
  post: WallPost;
  /** Retained for API compatibility; ownership is now derived from `post.mine`. */
  selfId: string;
  onDeleted?: (id: string) => void;
  showReplyLink?: boolean;
}) {
  const [post, setPost] = useState<WallPost>(initial);
  const [reported, setReported] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const isMine = post.mine;

  // Long posts are clamped in the feed with an inline "more" toggle (Twitter/Reddit style).
  const BODY_LIMIT = 280;
  const isLong = (post.body?.length ?? 0) > BODY_LIMIT;
  const shownBody =
    post.body && isLong && !expanded ? post.body.slice(0, BODY_LIMIT).trimEnd() : post.body;

  const toggleReaction = async () => {
    if (post.myReaction) {
      const { count } = await wallApi.unreact(post.id, 'wall_post');
      setPost((p) => ({ ...p, myReaction: null, reactionCount: count }));
    } else {
      const { count } = await wallApi.react(post.id, 'wall_post', 'like');
      setPost((p) => ({ ...p, myReaction: 'like', reactionCount: count }));
    }
  };

  const toggleBookmark = async () => {
    if (post.bookmarked) {
      await wallApi.unbookmark(post.id);
      setPost((p) => ({ ...p, bookmarked: false }));
    } else {
      await wallApi.bookmark(post.id);
      setPost((p) => ({ ...p, bookmarked: true }));
    }
  };

  const vote = async (optionId: string) => {
    const updated = await wallApi.vote(post.id, optionId);
    setPost(updated);
  };

  const confirmDelete = async () => {
    await wallApi.deletePost(post.id);
    onDeleted?.(post.id);
  };

  const report = async () => {
    setMenuOpen(false);
    await wallApi.report(post.id, 'wall_post', post.id, 'other');
    setReported(true);
  };

  const totalVotes = post.poll?.reduce((s, o) => s + o.voteCount, 0) ?? 0;
  const authorName = post.authorHandle;

  return (
    <article className="bg-background">
      {/* Header */}
      <div className="flex items-center justify-between gap-space-2 px-space-4 pt-space-4 pb-space-3 select-none">
        <div className="flex items-center gap-space-3">
          <Avatar name={post.authorHandle} mediaId={null} size="sm" />
          <div className="flex flex-col leading-tight">
            <div className="flex items-center gap-space-2">
              <span className="text-body font-semibold text-foreground">{authorName}</span>
              {post.postType === 'announcement' && (
                <span className="rounded-tooltip bg-brand px-space-2 py-0.5 text-small font-semibold text-brand-foreground">
                  Announcement
                </span>
              )}
            </div>
            <span className="flex items-center gap-space-1 text-caption text-muted-foreground">
              {post.category && <span>{post.category.name}</span>}
              {post.category && <span aria-hidden>·</span>}
              <time>{new Date(post.createdAt).toLocaleDateString()}</time>
            </span>
          </div>
        </div>

        {/* Overflow menu (report / delete) */}
        <div className="relative">
          <button
            type="button"
            aria-label="More options"
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-full p-space-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden />
              <div className="absolute right-0 top-full z-20 mt-space-1 w-40 overflow-hidden rounded-card border border-border bg-surface shadow-lg">
                {!reported && !isMine && (
                  <button
                    onClick={() => void report()}
                    className="flex w-full items-center gap-space-2 px-space-3 py-space-2 text-left text-caption text-foreground hover:bg-muted"
                  >
                    <Flag className="h-4 w-4" /> Report
                  </button>
                )}
                {isMine && (
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      setShowDeleteConfirm(true);
                    }}
                    className="flex w-full items-center gap-space-2 px-space-3 py-space-2 text-left text-caption text-danger hover:bg-danger/10"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                )}
                {reported && (
                  <span className="block px-space-3 py-space-2 text-caption text-muted-foreground">
                    Reported
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      {post.body && (
        <p className="whitespace-pre-wrap px-space-4 pb-space-3 text-body text-foreground">
          {shownBody}
          {isLong && !expanded && (
            <>
              {'… '}
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className="font-medium text-muted-foreground hover:text-foreground"
              >
                more
              </button>
            </>
          )}
          {isLong && expanded && (
            <>
              {' '}
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="font-medium text-muted-foreground hover:text-foreground"
              >
                less
              </button>
            </>
          )}
        </p>
      )}

      {/* Media — edge to edge */}
      {post.mediaIds.length > 0 && (
        <div className="flex flex-col bg-black/5">
          {post.mediaIds.map((mediaId) => (
            <MediaAttachment
              key={mediaId}
              context="wall"
              attachment={{
                mediaId,
                kind: 'image',
                mimeType: 'image/*',
                durationMs: null,
                expiresAt: null,
              }}
            />
          ))}
        </div>
      )}

      {/* Poll */}
      {post.poll && (
        <div className="flex flex-col gap-space-2 px-space-4 pt-space-3">
          {post.poll.map((opt) => {
            const pct = totalVotes ? Math.round((opt.voteCount / totalVotes) * 100) : 0;
            const mine = post.myVoteOptionId === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => void vote(opt.id)}
                className={cn(
                  'relative overflow-hidden rounded-button border px-space-3 py-space-2 text-left text-body',
                  mine ? 'border-brand text-foreground' : 'border-border text-foreground',
                )}
              >
                <span
                  className="absolute inset-y-0 left-0 bg-surface"
                  style={{ width: `${pct}%` }}
                  aria-hidden
                />
                <span className="relative flex justify-between gap-space-2">
                  <span>{opt.text}</span>
                  <span className="text-muted-foreground">{pct}%</span>
                </span>
              </button>
            );
          })}
          <span className="text-small text-muted-foreground">{totalVotes} votes</span>
        </div>
      )}

      {/* Tags */}
      {post.tags.length > 0 && (
        <div className="flex flex-wrap gap-space-1 px-space-4 pt-space-2">
          {post.tags.map((t) => (
            <span key={t} className="text-small text-brand">
              #{t}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-space-5 px-space-4 pt-space-3 pb-space-1">
        <button
          type="button"
          onClick={() => void toggleReaction()}
          aria-label="Like"
          className="flex items-center gap-space-1 text-foreground transition-colors hover:text-danger"
        >
          <Heart
            className={cn(
              'h-6 w-6 transition-transform active:scale-125',
              post.myReaction && 'fill-danger text-danger',
            )}
          />
        </button>
        {showReplyLink && (
          <Link
            href={`/wall/${post.id}`}
            aria-label="Replies"
            className="flex items-center gap-space-1 text-foreground transition-colors hover:text-brand"
          >
            <MessageCircle className="h-6 w-6" />
          </Link>
        )}
        <button
          type="button"
          onClick={() => void toggleBookmark()}
          aria-label="Bookmark"
          className="ml-auto text-foreground transition-colors hover:text-brand"
        >
          <Bookmark
            className={cn('h-6 w-6', post.bookmarked && 'fill-foreground text-foreground')}
          />
        </button>
      </div>

      {/* Counts */}
      <div className="flex items-center gap-space-3 px-space-4 pb-space-4 text-caption text-muted-foreground">
        <span className="font-medium text-foreground">
          {post.reactionCount} {post.reactionCount === 1 ? 'like' : 'likes'}
        </span>
        {post.replyCount > 0 && (
          <Link href={`/wall/${post.id}`} className="hover:text-foreground">
            {post.replyCount} {post.replyCount === 1 ? 'reply' : 'replies'}
          </Link>
        )}
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="flex items-center justify-between gap-space-2 border-t border-divider px-space-4 py-space-3">
          <span className="text-small font-medium text-danger">Delete this post forever?</span>
          <div className="flex gap-space-2">
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="rounded-button px-space-3 py-space-1 text-small text-muted-foreground hover:bg-muted"
            >
              Cancel
            </button>
            <button
              onClick={() => void confirmDelete()}
              className="rounded-button bg-danger px-space-3 py-space-1 text-small font-semibold text-white hover:bg-danger/90"
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
