'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { WallPost } from '@campusly/shared-types';
import { Heart, MessageCircle, Bookmark, Flag, Trash2 } from 'lucide-react';
import { wallApi } from '../../lib/wall';
import { MediaAttachment } from '../MediaAttachment';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Avatar } from '../Avatar';
import { cn } from '../../lib/utils';

/**
 * A single wall post (PUBLIC_WALL.md §6, UI_GUIDELINES.md §12): author/anonymous
 * header, body, media, poll, tags, and a supportive reaction bar (no clout
 * scores). Self-contained optimistic actions; reports content for moderation.
 */
export function PostCard({
  post: initial,
  selfId,
  onDeleted,
  showReplyLink = true,
}: {
  post: WallPost;
  selfId: string;
  onDeleted?: (id: string) => void;
  showReplyLink?: boolean;
}) {
  const [post, setPost] = useState<WallPost>(initial);
  const [reported, setReported] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const isMine = post.author?.id === selfId;

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
    await wallApi.report(post.id, 'wall_post', post.id, 'other');
    setReported(true);
  };

  const totalVotes = post.poll?.reduce((s, o) => s + o.voteCount, 0) ?? 0;

  return (
    <Card className="flex flex-col gap-space-3 hover:shadow-md transition-shadow rounded-none md:rounded-card border-x-0 md:border-x">
      <div className="flex items-center justify-between gap-space-2 select-none">
        <div className="flex items-center gap-space-3">
          <Avatar
            name={post.isAnonymous ? '?' : (post.author?.name ?? 'Student')}
            mediaId={post.isAnonymous ? null : (post.author?.avatarMediaId ?? null)}
            size="sm"
          />
          <div className="flex flex-col">
            <div className="flex items-center gap-space-2">
              <span className="text-body font-semibold text-foreground">
                {post.isAnonymous ? 'Anonymous' : (post.author?.name ?? 'Student')}
              </span>
              {post.category && (
                <span className="rounded-tooltip bg-muted px-space-2 py-0.5 text-small text-muted-foreground">
                  {post.category.name}
                </span>
              )}
              {post.postType === 'announcement' && (
                <span className="rounded-tooltip bg-brand px-space-2 py-0.5 text-small text-brand-foreground font-semibold">
                  Announcement
                </span>
              )}
            </div>
            <time className="text-caption text-muted-foreground mt-0.5">
              {new Date(post.createdAt).toLocaleDateString()}
            </time>
          </div>
        </div>
      </div>

      {post.body && <p className="whitespace-pre-wrap text-body text-foreground">{post.body}</p>}

      {post.mediaIds.length > 0 && (
        <div className="-mx-space-5 border-y border-border/40 flex flex-col bg-muted/5 overflow-hidden">
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

      {post.poll && (
        <div className="flex flex-col gap-space-2">
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

      {post.tags.length > 0 && (
        <div className="flex flex-wrap gap-space-1">
          {post.tags.map((t) => (
            <span key={t} className="text-small text-brand">
              #{t}
            </span>
          ))}
        </div>
      )}

      {showDeleteConfirm ? (
        <div className="flex items-center justify-between border-t border-border pt-space-3 mt-space-1">
          <span className="text-small font-medium text-danger">Delete this post forever?</span>
          <div className="flex gap-space-2">
            <Button variant="ghost" size="sm" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="bg-danger text-white hover:bg-danger/90"
              size="sm"
              onClick={() => void confirmDelete()}
            >
              Delete
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-space-1 border-t border-border pt-space-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void toggleReaction()}
            aria-label="Like"
            className="hover:text-danger hover:bg-danger/10 rounded-full transition-all duration-200"
          >
            <Heart
              className={cn(
                'h-4 w-4 transition-transform active:scale-125',
                post.myReaction && 'fill-danger text-danger',
              )}
            />
            <span className="ml-space-1 text-small">{post.reactionCount}</span>
          </Button>
          {showReplyLink && (
            <Link href={`/wall/${post.id}`}>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Replies"
                className="hover:text-brand hover:bg-brand/10 rounded-full transition-all duration-200"
              >
                <MessageCircle className="h-4 w-4" />
                <span className="ml-space-1 text-small">{post.replyCount}</span>
              </Button>
            </Link>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void toggleBookmark()}
            aria-label="Bookmark"
            className="hover:text-brand hover:bg-brand/10 rounded-full transition-all duration-200"
          >
            <Bookmark
              className={cn(
                'h-4 w-4 transition-transform active:scale-125',
                post.bookmarked && 'fill-foreground text-foreground',
              )}
            />
          </Button>
          <div className="ml-auto flex items-center gap-space-1">
            {!reported && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void report()}
                aria-label="Report"
                className="hover:text-warning hover:bg-warning/10 rounded-full transition-all duration-200"
              >
                <Flag className="h-4 w-4" />
              </Button>
            )}
            {reported && (
              <span className="text-small text-muted-foreground px-space-2">Reported</span>
            )}
            {isMine && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                aria-label="Delete"
                className="hover:text-danger hover:bg-danger/10 rounded-full transition-all duration-200"
              >
                <Trash2 className="h-4 w-4 text-danger" />
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
