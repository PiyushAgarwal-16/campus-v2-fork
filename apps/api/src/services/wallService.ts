import type {
  AccessTokenClaims,
  CreatePostInput,
  CreateReplyInput,
  ReactionType,
  WallPost,
  WallReply,
  WallCategory,
  PollOption,
} from '@campusly/shared-types';
import { WALL_SERVER_EVENTS } from '@campusly/shared-types';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import type { WallPostRow, WallReplyRow } from '../db/schema.js';
import { wallRepository } from '../repositories/wallRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { generateAnonHandle } from '../lib/anonHandle.js';
import { mediaRepository } from '../repositories/mediaRepository.js';
import { reportRepository } from '../repositories/reportRepository.js';
import { notifier } from '../realtime/notifier.js';
import { notificationService } from './notificationService.js';

/**
 * Campus Wall business logic (PUBLIC_WALL.md). Campus-scoped, accountable
 * anonymity (author always retained, hidden from peers). Creation is REST;
 * realtime fan-out goes to the campus room (SOCKET_EVENTS.md §9).
 */

const ANNOUNCEMENT_ROLES = [
  'club_admin',
  'community_moderator',
  'moderator',
  'admin',
  'super_admin',
];

function campusRoom(universityId: string): string {
  return `campus:${universityId}`;
}

export const wallService = {
  async listCategories(universityId: string): Promise<WallCategory[]> {
    const rows = await wallRepository.listCategories(universityId);
    return rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug }));
  },

  /** Create a post (text/poll/announcement). Announcements require a privileged role. */
  async createPost(claims: AccessTokenClaims, input: CreatePostInput): Promise<WallPost> {
    if (input.postType === 'announcement' && !ANNOUNCEMENT_ROLES.includes(claims.role)) {
      throw new ForbiddenError('Only club admins and moderators can post announcements.');
    }
    if (input.categoryId) {
      const category = await wallRepository.getCategory(input.categoryId);
      if (!category || (category.universityId && category.universityId !== claims.universityId)) {
        throw new ValidationError('Invalid category.');
      }
    }
    // Validate any attached media is the user's own active media.
    if (input.mediaIds?.length) {
      const media = await mediaRepository.findManyByIds(input.mediaIds);
      // Wall attachments are images only (SECURITY.md — restrict upload surface).
      const valid = media.filter(
        (m) => m.ownerId === claims.sub && m.status === 'active' && m.kind === 'image',
      );
      if (valid.length !== input.mediaIds.length) {
        throw new ValidationError('Only image attachments are allowed on the wall.');
      }
    }

    // Every wall post is anonymous now (accountable anonymity §7): author_id is
    // still retained server-side, but never exposed. Ignore any client flag.
    const post = await wallRepository.insertPost({
      universityId: claims.universityId,
      authorId: claims.sub,
      isAnonymous: true,
      categoryId: input.categoryId ?? null,
      postType: input.postType,
      body: input.body ?? null,
    });
    // Pre-warm the author's permanent handle so it is ready on first read.
    await this.resolveHandles([claims.sub]);
    if (input.tags?.length) await wallRepository.attachTags(post.id, input.tags);
    if (input.mediaIds?.length) await wallRepository.attachMedia(post.id, input.mediaIds);
    if (input.postType === 'poll' && input.pollOptions?.length) {
      await wallRepository.createPollOptions(post.id, input.pollOptions);
    }

    const [assembled] = await this.assemblePosts(claims.sub, [post]);
    if (!assembled) throw new Error('Failed to assemble created post');

    // Realtime fan-out to the campus (anonymized payload — no viewer-specific state).
    const [publicDto] = await this.assemblePosts(null, [post]);
    notifier.emitToRoom(campusRoom(claims.universityId), WALL_SERVER_EVENTS.NEW_POST, {
      post: publicDto,
    });
    if (input.postType === 'announcement') {
      notifier.emitToRoom(
        campusRoom(claims.universityId),
        WALL_SERVER_EVENTS.ANNOUNCEMENT_CREATED,
        {
          announcement: publicDto,
        },
      );
    }
    return assembled;
  },

  async feed(
    claims: AccessTokenClaims,
    query: { mode: 'latest' | 'trending'; categoryId?: string; cursor?: string; limit: number },
  ): Promise<{ posts: WallPost[]; nextCursor: string | null }> {
    const rows =
      query.mode === 'trending'
        ? await wallRepository.feedTrending({
            universityId: claims.universityId,
            limit: query.limit,
          })
        : await wallRepository.feedLatest({
            universityId: claims.universityId,
            categoryId: query.categoryId,
            cursor: query.cursor,
            limit: query.limit,
          });
    const posts = await this.assemblePosts(claims.sub, rows);
    // Trending is score-ordered (no time cursor); latest uses created_at cursor.
    const nextCursor =
      query.mode === 'latest' && rows.length === query.limit
        ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null)
        : null;
    return { posts, nextCursor };
  },

  async search(
    claims: AccessTokenClaims,
    query: { q: string; cursor?: string; limit: number },
  ): Promise<{ posts: WallPost[]; nextCursor: string | null }> {
    const rows = await wallRepository.search({
      universityId: claims.universityId,
      query: query.q,
      cursor: query.cursor,
      limit: query.limit,
    });
    const posts = await this.assemblePosts(claims.sub, rows);
    const nextCursor =
      rows.length === query.limit ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null;
    return { posts, nextCursor };
  },

  async getPost(
    claims: AccessTokenClaims,
    postId: string,
  ): Promise<{ post: WallPost; replies: WallReply[] }> {
    const row = await this.requireVisiblePost(postId, claims.universityId);
    const [post] = await this.assemblePosts(claims.sub, [row]);
    if (!post) throw new NotFoundError('Post not found.');
    const replyRows = await wallRepository.listReplies(postId);
    const replies = await this.assembleReplies(claims.sub, replyRows);
    return { post, replies };
  },

  async updatePost(claims: AccessTokenClaims, postId: string, body: string): Promise<WallPost> {
    const row = await this.requireVisiblePost(postId, claims.universityId);
    if (row.authorId !== claims.sub) throw new ForbiddenError('You can only edit your own post.');
    await wallRepository.updatePostBody(postId, body);
    const updated = await wallRepository.getPostById(postId);
    const [post] = await this.assemblePosts(claims.sub, updated ? [updated] : []);
    if (!post) throw new NotFoundError('Post not found.');
    return post;
  },

  async deletePost(claims: AccessTokenClaims, postId: string): Promise<void> {
    const row = await this.requireVisiblePost(postId, claims.universityId);
    if (row.authorId !== claims.sub) throw new ForbiddenError('You can only delete your own post.');
    await wallRepository.softDeletePost(postId);
    notifier.emitToRoom(campusRoom(claims.universityId), WALL_SERVER_EVENTS.POST_DELETED, {
      postId,
    });
  },

  async createReply(
    claims: AccessTokenClaims,
    postId: string,
    input: CreateReplyInput,
  ): Promise<WallReply> {
    const post = await this.requireVisiblePost(postId, claims.universityId);
    // Replies are always anonymous now; author_id is retained server-side only.
    const row = await wallRepository.insertReply({
      postId,
      authorId: claims.sub,
      isAnonymous: true,
      body: input.body,
    });
    await wallRepository.incReplyCount(postId, 1);
    const [reply] = await this.assembleReplies(claims.sub, [row]);
    if (!reply) throw new Error('Failed to assemble reply');
    const [publicReply] = await this.assembleReplies(null, [row]);
    notifier.emitToRoom(campusRoom(claims.universityId), WALL_SERVER_EVENTS.NEW_REPLY, {
      postId,
      reply: publicReply,
    });
    // Notify the post author using the replier's pseudonymous handle (never the real name).
    const handles = await this.resolveHandles([claims.sub]);
    const replierName = handles.get(claims.sub) ?? 'Someone';
    void notificationService.wallReply(post.authorId, claims.sub, replierName, postId);
    return reply;
  },

  async deleteReply(claims: AccessTokenClaims, replyId: string): Promise<void> {
    const reply = await wallRepository.getReplyById(replyId);
    if (!reply || reply.deletedAt) throw new NotFoundError('Reply not found.');
    if (reply.authorId !== claims.sub) {
      throw new ForbiddenError('You can only delete your own reply.');
    }
    await wallRepository.softDeleteReply(replyId);
    await wallRepository.incReplyCount(reply.postId, -1);
  },

  async react(
    claims: AccessTokenClaims,
    targetType: 'wall_post' | 'wall_reply',
    targetId: string,
    type: ReactionType,
  ): Promise<{ count: number }> {
    await this.assertTargetInCampus(targetType, targetId, claims.universityId);
    const count = await wallRepository.react(claims.sub, targetType, targetId, type);
    notifier.emitToRoom(campusRoom(claims.universityId), WALL_SERVER_EVENTS.NEW_REACTION, {
      targetType,
      targetId,
      count,
    });
    // Notify the post author when someone reacts to their post, using the
    // actor's pseudonymous handle (never their real name).
    if (targetType === 'wall_post') {
      const post = await wallRepository.getPostById(targetId);
      if (post && post.authorId !== claims.sub) {
        const handles = await this.resolveHandles([claims.sub]);
        void notificationService.wallReaction(
          post.authorId,
          claims.sub,
          handles.get(claims.sub) ?? 'Someone',
          targetId,
        );
      }
    }
    return { count };
  },

  async unreact(
    claims: AccessTokenClaims,
    targetType: 'wall_post' | 'wall_reply',
    targetId: string,
  ): Promise<{ count: number }> {
    await this.assertTargetInCampus(targetType, targetId, claims.universityId);
    const count = await wallRepository.unreact(claims.sub, targetType, targetId);
    notifier.emitToRoom(campusRoom(claims.universityId), WALL_SERVER_EVENTS.NEW_REACTION, {
      targetType,
      targetId,
      count,
    });
    return { count };
  },

  async bookmark(claims: AccessTokenClaims, postId: string): Promise<void> {
    await this.requireVisiblePost(postId, claims.universityId);
    await wallRepository.addBookmark(claims.sub, postId);
  },

  async unbookmark(claims: AccessTokenClaims, postId: string): Promise<void> {
    await wallRepository.removeBookmark(claims.sub, postId);
  },

  async listBookmarks(
    claims: AccessTokenClaims,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ posts: WallPost[]; nextCursor: string | null }> {
    const rows = await wallRepository.listBookmarkedPosts(claims.sub, cursor, limit);
    const posts = await this.assemblePosts(claims.sub, rows);
    const nextCursor = rows.length === limit ? (posts[posts.length - 1]?.createdAt ?? null) : null;
    return { posts, nextCursor };
  },

  async votePoll(claims: AccessTokenClaims, postId: string, optionId: string): Promise<WallPost> {
    const row = await this.requireVisiblePost(postId, claims.universityId);
    if (row.postType !== 'poll') throw new ValidationError('This post is not a poll.');
    const option = await wallRepository.getPollOption(optionId);
    if (!option || option.postId !== postId) throw new ValidationError('Invalid poll option.');
    await wallRepository.votePoll(postId, claims.sub, optionId);
    const updated = await wallRepository.getPostById(postId);
    const [post] = await this.assemblePosts(claims.sub, updated ? [updated] : []);
    if (!post) throw new NotFoundError('Post not found.');
    return post;
  },

  async report(
    claims: AccessTokenClaims,
    targetType: 'wall_post' | 'wall_reply',
    targetId: string,
    reason: 'spam' | 'harassment' | 'hate' | 'nsfw' | 'safety' | 'other',
    details?: string,
  ): Promise<void> {
    await this.assertTargetInCampus(targetType, targetId, claims.universityId);
    await reportRepository.create({
      reporterId: claims.sub,
      targetType,
      targetId,
      reason,
      details,
    });
  },

  async listUserPosts(
    claims: AccessTokenClaims,
    authorId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<{ posts: WallPost[]; nextCursor: string | null }> {
    const rows = await wallRepository.listPostsByAuthor(authorId, cursor, limit);
    const posts = await this.assemblePosts(claims.sub, rows);
    const nextCursor =
      rows.length === limit ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null;
    return { posts, nextCursor };
  },

  // --- internal ---

  async requireVisiblePost(postId: string, universityId: string): Promise<WallPostRow> {
    const row = await wallRepository.getPostById(postId);
    if (!row || row.deletedAt || row.status !== 'visible')
      throw new NotFoundError('Post not found.');
    if (row.universityId !== universityId) throw new NotFoundError('Post not found.'); // campus scope
    return row;
  },

  async assertTargetInCampus(
    targetType: 'wall_post' | 'wall_reply',
    targetId: string,
    universityId: string,
  ): Promise<void> {
    if (targetType === 'wall_post') {
      await this.requireVisiblePost(targetId, universityId);
      return;
    }
    const reply = await wallRepository.getReplyById(targetId);
    if (!reply || reply.deletedAt || reply.status !== 'visible') {
      throw new NotFoundError('Reply not found.');
    }
    await this.requireVisiblePost(reply.postId, universityId);
  },

  /**
   * Resolve permanent pseudonymous handles for a set of authors, assigning one
   * lazily to any user who does not yet have it (PUBLIC_WALL.md §7). Handles are
   * unique; on a collision we retry with a wider candidate space.
   */
  async resolveHandles(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    const map = await userRepository.getAnonHandles(unique);
    for (const id of unique) {
      if (map.has(id)) continue;
      let resolved: string | null = null;
      for (let attempt = 0; attempt < 6 && resolved === null; attempt += 1) {
        const candidate = generateAnonHandle(attempt);
        const result = await userRepository.assignAnonHandleIfEmpty(id, candidate);
        if (result.assigned || result.handle !== null) {
          // Either we claimed it, or the user already had a handle (race).
          resolved = result.handle;
        }
        // Otherwise a unique conflict occurred: loop and retry with a new candidate.
      }
      if (resolved === null) {
        // Final fallback: a very wide candidate plus a short random suffix.
        const fallbackBase = generateAnonHandle(99);
        const suffix = Math.random().toString(36).slice(2, 6);
        const result = await userRepository.assignAnonHandleIfEmpty(id, `${fallbackBase}${suffix}`);
        resolved = result.handle ?? `${fallbackBase}${suffix}`;
      }
      map.set(id, resolved);
    }
    return map;
  },

  /** Assemble post DTOs. viewerId null → no viewer-specific state (broadcast). */
  async assemblePosts(viewerId: string | null, rows: WallPostRow[]): Promise<WallPost[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const categoryIds = [
      ...new Set(rows.map((r) => r.categoryId).filter((c): c is string => Boolean(c))),
    ];

    const [handles, tagsMap, mediaMap, pollMap, myReactions, bookmarked, myVotes, categories] =
      await Promise.all([
        this.resolveHandles(rows.map((r) => r.authorId)),
        wallRepository.tagsForPosts(ids),
        wallRepository.mediaForPosts(ids),
        wallRepository.pollOptionsForPosts(ids),
        viewerId
          ? wallRepository.myReactions(viewerId, 'wall_post', ids)
          : Promise.resolve(new Map()),
        viewerId ? wallRepository.bookmarkedSet(viewerId, ids) : Promise.resolve(new Set<string>()),
        viewerId ? wallRepository.myPollVotes(viewerId, ids) : Promise.resolve(new Map()),
        this.categoriesByIds(categoryIds),
      ]);

    return rows.map((r) => {
      const pollRows = pollMap.get(r.id);
      const poll: PollOption[] | null =
        r.postType === 'poll' && pollRows
          ? pollRows.map((o) => ({ id: o.id, text: o.text, voteCount: o.voteCount }))
          : null;
      return {
        id: r.id,
        author: null,
        authorHandle: handles.get(r.authorId) ?? 'Anonymous',
        mine: viewerId !== null && r.authorId === viewerId,
        isAnonymous: true,
        postType: r.postType,
        category: categories.get(r.categoryId ?? '') ?? null,
        body: r.body,
        tags: tagsMap.get(r.id) ?? [],
        mediaIds: mediaMap.get(r.id) ?? [],
        poll,
        myVoteOptionId: myVotes.get(r.id) ?? null,
        replyCount: r.replyCount,
        reactionCount: r.reactionCount,
        myReaction: (myReactions.get(r.id) as ReactionType | undefined) ?? null,
        bookmarked: bookmarked.has(r.id),
        isPinned: r.isPinned,
        createdAt: r.createdAt.toISOString(),
      };
    });
  },

  async assembleReplies(viewerId: string | null, rows: WallReplyRow[]): Promise<WallReply[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [handles, myReactions] = await Promise.all([
      this.resolveHandles(rows.map((r) => r.authorId)),
      viewerId
        ? wallRepository.myReactions(viewerId, 'wall_reply', ids)
        : Promise.resolve(new Map()),
    ]);
    return rows.map((r) => ({
      id: r.id,
      postId: r.postId,
      author: null,
      authorHandle: handles.get(r.authorId) ?? 'Anonymous',
      mine: viewerId !== null && r.authorId === viewerId,
      isAnonymous: true,
      body: r.body,
      reactionCount: r.reactionCount,
      myReaction: (myReactions.get(r.id) as ReactionType | undefined) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  },

  async categoriesByIds(ids: string[]): Promise<Map<string, WallCategory>> {
    const map = new Map<string, WallCategory>();
    for (const id of ids) {
      const c = await wallRepository.getCategory(id);
      if (c) map.set(c.id, { id: c.id, name: c.name, slug: c.slug });
    }
    return map;
  },
};

/**
 * Trending materialization (PUBLIC_WALL.md §5, DATABASE_SCHEMA.md §10.8): a
 * background job recomputes time-decayed scores into trending_posts so the feed
 * reads cheaply instead of computing per request.
 */
const TRENDING_INTERVAL_MS = 5 * 60 * 1000;
let trendingTimer: NodeJS.Timeout | null = null;

export function startTrendingJob(): void {
  if (trendingTimer) return;
  void wallRepository.recomputeTrending().catch(() => {});
  trendingTimer = setInterval(() => {
    void wallRepository.recomputeTrending().catch(() => {});
  }, TRENDING_INTERVAL_MS);
  trendingTimer.unref?.();
}

/** Stop the trending materialization job (graceful shutdown). Idempotent. */
export function stopTrendingJob(): void {
  if (!trendingTimer) return;
  clearInterval(trendingTimer);
  trendingTimer = null;
}

/** Documented default categories (PUBLIC_WALL.md §4), seeded as global rows. */
export const DEFAULT_WALL_CATEGORIES = [
  { name: 'Academics', slug: 'academics' },
  { name: 'Placements', slug: 'placements' },
  { name: 'Events', slug: 'events' },
  { name: 'Clubs', slug: 'clubs' },
  { name: 'Confessions', slug: 'confessions' },
  { name: 'Memes', slug: 'memes' },
  { name: 'Questions', slug: 'questions' },
  { name: 'Marketplace', slug: 'marketplace' },
  { name: 'Lost & Found', slug: 'lost-found' },
  { name: 'Technology', slug: 'technology' },
  { name: 'General', slug: 'general' },
];
