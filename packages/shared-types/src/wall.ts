import { z } from 'zod';

/**
 * Campus Wall contracts (PUBLIC_WALL.md, DATABASE_SCHEMA.md §10, API_SPEC.md §7,
 * SOCKET_EVENTS.md §9). Campus-scoped public feed: posts (named/anonymous),
 * replies, polymorphic reactions, bookmarks, categories, tags, polls, trending.
 */

export const WALL_POST_TYPES = ['text', 'poll', 'announcement'] as const;
export type WallPostType = (typeof WALL_POST_TYPES)[number];

export const CONTENT_STATUSES = ['visible', 'hidden', 'removed'] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

export const REACTION_TARGETS = ['wall_post', 'wall_reply', 'community_post'] as const;
export type ReactionTarget = (typeof REACTION_TARGETS)[number];

export const REACTION_TYPES = ['like', 'love', 'laugh', 'insightful', 'support'] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const WALL_FEED_MODES = ['latest', 'trending'] as const;
export type WallFeedMode = (typeof WALL_FEED_MODES)[number];

/** Report reasons (shared with matching/moderation — DATABASE_SCHEMA.md §15.1). */
export const REPORT_TARGETS = [
  'user',
  'wall_post',
  'wall_reply',
  'community_post',
  'message',
  'marketplace_item',
  'lost_found_item',
] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

/** Public author view — null when the post/reply is anonymous (accountable anonymity §7). */
export interface WallAuthor {
  id: string;
  name: string;
  avatarMediaId: string | null;
}

export interface WallCategory {
  id: string;
  name: string;
  slug: string;
}

export interface PollOption {
  id: string;
  text: string;
  voteCount: number;
}

/** A wall post as delivered to clients. Author is null for anonymous posts. */
export interface WallPost {
  id: string;
  author: WallAuthor | null;
  /** Permanent pseudonymous handle shown for the author on the wall (e.g. "SilentFox73"). */
  authorHandle: string;
  /** True when the current viewer authored this post. */
  mine: boolean;
  isAnonymous: boolean;
  postType: WallPostType;
  category: WallCategory | null;
  body: string | null;
  tags: string[];
  mediaIds: string[];
  poll: PollOption[] | null;
  myVoteOptionId: string | null;
  replyCount: number;
  reactionCount: number;
  myReaction: ReactionType | null;
  bookmarked: boolean;
  isPinned: boolean;
  createdAt: string;
}

export interface WallReply {
  id: string;
  postId: string;
  author: WallAuthor | null;
  /** Permanent pseudonymous handle shown for the author on the wall (e.g. "SilentFox73"). */
  authorHandle: string;
  /** True when the current viewer authored this reply. */
  mine: boolean;
  isAnonymous: boolean;
  body: string;
  reactionCount: number;
  myReaction: ReactionType | null;
  createdAt: string;
}

export interface WallFeedResponse {
  posts: WallPost[];
  nextCursor: string | null;
}

// --- Request schemas (API_SPEC.md §7) ---

export const CreatePostSchema = z
  .object({
    postType: z.enum(WALL_POST_TYPES).default('text'),
    body: z.string().trim().max(5000).optional(),
    categoryId: z.string().uuid().optional(),
    isAnonymous: z.boolean().default(false),
    tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
    mediaIds: z.array(z.string().uuid()).max(4).optional(),
    pollOptions: z.array(z.string().trim().min(1).max(120)).min(2).max(6).optional(),
  })
  .refine((v) => (v.postType === 'poll' ? Boolean(v.pollOptions?.length) : true), {
    message: 'Polls require at least two options.',
  })
  .refine(
    (v) => v.postType === 'poll' || (v.body && v.body.length > 0) || (v.mediaIds?.length ?? 0) > 0,
    {
      message: 'A post needs text or media.',
    },
  );
export type CreatePostInput = z.infer<typeof CreatePostSchema>;

export const UpdatePostSchema = z.object({
  body: z.string().trim().max(5000),
});
export type UpdatePostInput = z.infer<typeof UpdatePostSchema>;

export const CreateReplySchema = z.object({
  body: z.string().trim().min(1).max(2000),
  isAnonymous: z.boolean().default(false),
});
export type CreateReplyInput = z.infer<typeof CreateReplySchema>;

export const ReactSchema = z.object({
  targetType: z.enum(['wall_post', 'wall_reply']),
  type: z.enum(REACTION_TYPES).default('like'),
});
export type ReactInput = z.infer<typeof ReactSchema>;

export const VotePollSchema = z.object({ optionId: z.string().uuid() });
export type VotePollInput = z.infer<typeof VotePollSchema>;

export const ReportContentSchema = z.object({
  targetType: z.enum(['wall_post', 'wall_reply']),
  targetId: z.string().uuid(),
  reason: z.enum(['spam', 'harassment', 'hate', 'nsfw', 'safety', 'other']),
  details: z.string().trim().max(1000).optional(),
});
export type ReportContentInput = z.infer<typeof ReportContentSchema>;

export const WallFeedQuerySchema = z.object({
  mode: z.enum(WALL_FEED_MODES).default('latest'),
  categoryId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type WallFeedQuery = z.infer<typeof WallFeedQuerySchema>;

export const WallSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type WallSearchQuery = z.infer<typeof WallSearchQuerySchema>;

// --- Socket events (SOCKET_EVENTS.md §9; creation is REST, fan-out is realtime) ---

export const WALL_SERVER_EVENTS = {
  NEW_POST: 'new_post',
  NEW_REPLY: 'new_reply',
  NEW_REACTION: 'new_reaction',
  POST_DELETED: 'post_deleted',
  ANNOUNCEMENT_CREATED: 'announcement_created',
} as const;

export interface NewReactionPayload {
  targetType: ReactionTarget;
  targetId: string;
  count: number;
}
