import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { ReactionType, WallPostType } from '@campusly/shared-types';
import { db } from '../db/client.js';
import {
  wallPosts,
  wallReplies,
  wallCategories,
  reactions,
  bookmarks,
  tags,
  postTags,
  postMedia,
  trendingPosts,
  wallPollOptions,
  wallPollVotes,
  type WallPostRow,
  type WallReplyRow,
  type WallCategoryRow,
  type WallPollOptionRow,
} from '../db/schema.js';

/**
 * Data access for the Campus Wall (DATABASE_SCHEMA.md §10). Campus-scoped,
 * read-heavy; uses maintained counters and cursor pagination. Soft-deleted /
 * non-visible rows are excluded at this layer.
 */
type ReactionTargetType = 'wall_post' | 'wall_reply';

export const wallRepository = {
  // --- Categories ---
  async listCategories(_universityId?: string): Promise<WallCategoryRow[]> {
    // Universal mode: return all categories (global + any campus-specific).
    // Campus-scoping will be re-added as a premium feature.
    return db.select().from(wallCategories);
  },

  async ensureGlobalCategories(defaults: { name: string; slug: string }[]): Promise<void> {
    // Idempotent seed of global categories. NOTE: the unique index is on
    // (university_id, slug), and Postgres treats NULL university_id as distinct,
    // so onConflictDoNothing would NOT dedupe globals — we check existence first.
    for (const c of defaults) {
      const existing = await db
        .select({ id: wallCategories.id })
        .from(wallCategories)
        .where(and(isNull(wallCategories.universityId), eq(wallCategories.slug, c.slug)))
        .limit(1);
      if (existing.length === 0) {
        await db.insert(wallCategories).values({ universityId: null, name: c.name, slug: c.slug });
      }
    }
  },

  async getCategory(id: string): Promise<WallCategoryRow | null> {
    const rows = await db.select().from(wallCategories).where(eq(wallCategories.id, id)).limit(1);
    return rows[0] ?? null;
  },

  // --- Posts ---
  async insertPost(input: {
    universityId: string;
    authorId: string;
    isAnonymous: boolean;
    categoryId: string | null;
    postType: WallPostType;
    body: string | null;
  }): Promise<WallPostRow> {
    const [row] = await db
      .insert(wallPosts)
      .values({
        universityId: input.universityId,
        authorId: input.authorId,
        isAnonymous: input.isAnonymous,
        categoryId: input.categoryId,
        postType: input.postType,
        body: input.body,
      })
      .returning();
    if (!row) throw new Error('Failed to create post');
    return row;
  },

  async getPostById(id: string): Promise<WallPostRow | null> {
    const rows = await db.select().from(wallPosts).where(eq(wallPosts.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async updatePostBody(id: string, body: string): Promise<void> {
    await db.update(wallPosts).set({ body, updatedAt: new Date() }).where(eq(wallPosts.id, id));
  },

  async softDeletePost(id: string): Promise<void> {
    await db
      .update(wallPosts)
      .set({ status: 'removed', deletedAt: new Date() })
      .where(eq(wallPosts.id, id));
  },

  /** Global feed, latest-first, cursor on created_at (§10 primary read). */
  async feedLatest(input: {
    universityId?: string;
    categoryId?: string;
    cursor?: string;
    limit: number;
  }): Promise<WallPostRow[]> {
    // Universal mode: no campus filter. Campus-scoping will be a premium feature.
    const conditions = [eq(wallPosts.status, 'visible'), isNull(wallPosts.deletedAt)];
    if (input.categoryId) conditions.push(eq(wallPosts.categoryId, input.categoryId));
    if (input.cursor) conditions.push(lt(wallPosts.createdAt, new Date(input.cursor)));
    return db
      .select()
      .from(wallPosts)
      .where(and(...conditions))
      .orderBy(desc(wallPosts.createdAt))
      .limit(input.limit);
  },

  /** Trending feed via the materialized trending_posts table (§10.8). */
  async feedTrending(input: { universityId?: string; limit: number }): Promise<WallPostRow[]> {
    // Universal mode: no campus filter on trending. Campus-scoping is a premium feature.
    const rows = await db
      .select({ post: wallPosts })
      .from(trendingPosts)
      .innerJoin(wallPosts, eq(wallPosts.id, trendingPosts.postId))
      .where(and(eq(wallPosts.status, 'visible'), isNull(wallPosts.deletedAt)))
      .orderBy(desc(trendingPosts.score))
      .limit(input.limit);
    return rows.map((r) => r.post);
  },

  /** Full-text search over post bodies (§10 / FTS index). */
  async search(input: {
    universityId?: string;
    query: string;
    cursor?: string;
    limit: number;
  }): Promise<WallPostRow[]> {
    // Universal mode: no campus filter on search. Campus-scoping is a premium feature.
    const conditions = [
      eq(wallPosts.status, 'visible'),
      isNull(wallPosts.deletedAt),
      sql`to_tsvector('english', coalesce(${wallPosts.body}, '')) @@ plainto_tsquery('english', ${input.query})`,
    ];
    if (input.cursor) conditions.push(lt(wallPosts.createdAt, new Date(input.cursor)));
    return db
      .select()
      .from(wallPosts)
      .where(and(...conditions))
      .orderBy(desc(wallPosts.createdAt))
      .limit(input.limit);
  },

  async incReplyCount(postId: string, delta: number): Promise<void> {
    await db
      .update(wallPosts)
      .set({ replyCount: sql`${wallPosts.replyCount} + ${delta}` })
      .where(eq(wallPosts.id, postId));
  },

  // --- Replies ---
  async insertReply(input: {
    postId: string;
    authorId: string;
    isAnonymous: boolean;
    body: string;
  }): Promise<WallReplyRow> {
    const [row] = await db.insert(wallReplies).values(input).returning();
    if (!row) throw new Error('Failed to create reply');
    return row;
  },

  async getReplyById(id: string): Promise<WallReplyRow | null> {
    const rows = await db.select().from(wallReplies).where(eq(wallReplies.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async listReplies(postId: string): Promise<WallReplyRow[]> {
    return db
      .select()
      .from(wallReplies)
      .where(
        and(
          eq(wallReplies.postId, postId),
          eq(wallReplies.status, 'visible'),
          isNull(wallReplies.deletedAt),
        ),
      )
      .orderBy(wallReplies.createdAt);
  },

  async softDeleteReply(id: string): Promise<void> {
    await db
      .update(wallReplies)
      .set({ status: 'removed', deletedAt: new Date() })
      .where(eq(wallReplies.id, id));
  },

  // --- Reactions (polymorphic, idempotent) ---
  /** Upsert a reaction; returns the resulting maintained count for the target. */
  async react(
    userId: string,
    targetType: ReactionTargetType,
    targetId: string,
    type: ReactionType,
  ): Promise<number> {
    return db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: reactions.id })
        .from(reactions)
        .where(
          and(
            eq(reactions.userId, userId),
            eq(reactions.targetType, targetType),
            eq(reactions.targetId, targetId),
          ),
        )
        .limit(1);
      let delta = 0;
      if (existing[0]) {
        await tx.update(reactions).set({ type }).where(eq(reactions.id, existing[0].id));
      } else {
        await tx.insert(reactions).values({ userId, targetType, targetId, type });
        delta = 1;
      }
      if (delta !== 0) await applyReactionDelta(tx, targetType, targetId, delta);
      return readReactionCount(tx, targetType, targetId);
    });
  },

  async unreact(userId: string, targetType: ReactionTargetType, targetId: string): Promise<number> {
    return db.transaction(async (tx) => {
      const deleted = await tx
        .delete(reactions)
        .where(
          and(
            eq(reactions.userId, userId),
            eq(reactions.targetType, targetType),
            eq(reactions.targetId, targetId),
          ),
        )
        .returning({ id: reactions.id });
      if (deleted.length > 0) await applyReactionDelta(tx, targetType, targetId, -1);
      return readReactionCount(tx, targetType, targetId);
    });
  },

  /** A user's reactions on a set of targets, keyed by targetId. */
  async myReactions(
    userId: string,
    targetType: ReactionTargetType,
    targetIds: string[],
  ): Promise<Map<string, ReactionType>> {
    const map = new Map<string, ReactionType>();
    if (targetIds.length === 0) return map;
    const rows = await db
      .select({ targetId: reactions.targetId, type: reactions.type })
      .from(reactions)
      .where(
        and(
          eq(reactions.userId, userId),
          eq(reactions.targetType, targetType),
          inArray(reactions.targetId, targetIds),
        ),
      );
    for (const r of rows) map.set(r.targetId, r.type);
    return map;
  },

  // --- Bookmarks ---
  async addBookmark(userId: string, postId: string): Promise<void> {
    await db.insert(bookmarks).values({ userId, postId }).onConflictDoNothing();
  },

  async removeBookmark(userId: string, postId: string): Promise<void> {
    await db
      .delete(bookmarks)
      .where(and(eq(bookmarks.userId, userId), eq(bookmarks.postId, postId)));
  },

  async listBookmarkedPosts(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<WallPostRow[]> {
    const conditions = [eq(bookmarks.userId, userId)];
    if (cursor) conditions.push(lt(bookmarks.createdAt, new Date(cursor)));
    const rows = await db
      .select({ post: wallPosts, bookmarkedAt: bookmarks.createdAt })
      .from(bookmarks)
      .innerJoin(wallPosts, eq(wallPosts.id, bookmarks.postId))
      .where(and(...conditions, eq(wallPosts.status, 'visible'), isNull(wallPosts.deletedAt)))
      .orderBy(desc(bookmarks.createdAt))
      .limit(limit);
    return rows.map((r) => r.post);
  },

  async bookmarkedSet(userId: string, postIds: string[]): Promise<Set<string>> {
    const set = new Set<string>();
    if (postIds.length === 0) return set;
    const rows = await db
      .select({ postId: bookmarks.postId })
      .from(bookmarks)
      .where(and(eq(bookmarks.userId, userId), inArray(bookmarks.postId, postIds)));
    for (const r of rows) set.add(r.postId);
    return set;
  },

  // --- Tags ---
  async attachTags(postId: string, names: string[]): Promise<void> {
    const normalized = [...new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))];
    if (normalized.length === 0) return;
    await db
      .insert(tags)
      .values(normalized.map((name) => ({ name })))
      .onConflictDoNothing();
    const rows = await db.select({ id: tags.id }).from(tags).where(inArray(tags.name, normalized));
    if (rows.length > 0) {
      await db
        .insert(postTags)
        .values(rows.map((r) => ({ postId, tagId: r.id })))
        .onConflictDoNothing();
    }
  },

  async tagsForPosts(postIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (postIds.length === 0) return map;
    const rows = await db
      .select({ postId: postTags.postId, name: tags.name })
      .from(postTags)
      .innerJoin(tags, eq(tags.id, postTags.tagId))
      .where(inArray(postTags.postId, postIds));
    for (const r of rows) {
      const list = map.get(r.postId) ?? [];
      list.push(r.name);
      map.set(r.postId, list);
    }
    return map;
  },

  // --- Media ---
  async attachMedia(postId: string, mediaIds: string[]): Promise<void> {
    if (mediaIds.length === 0) return;
    await db
      .insert(postMedia)
      .values(mediaIds.map((mediaId, i) => ({ postId, mediaId, position: i })))
      .onConflictDoNothing();
  },

  async mediaForPosts(postIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (postIds.length === 0) return map;
    const rows = await db
      .select({
        postId: postMedia.postId,
        mediaId: postMedia.mediaId,
        position: postMedia.position,
      })
      .from(postMedia)
      .where(inArray(postMedia.postId, postIds))
      .orderBy(postMedia.position);
    for (const r of rows) {
      const list = map.get(r.postId) ?? [];
      list.push(r.mediaId);
      map.set(r.postId, list);
    }
    return map;
  },

  // --- Polls ---
  async createPollOptions(postId: string, options: string[]): Promise<void> {
    await db
      .insert(wallPollOptions)
      .values(options.map((text, i) => ({ postId, text, position: i })));
  },

  async pollOptionsForPosts(postIds: string[]): Promise<Map<string, WallPollOptionRow[]>> {
    const map = new Map<string, WallPollOptionRow[]>();
    if (postIds.length === 0) return map;
    const rows = await db
      .select()
      .from(wallPollOptions)
      .where(inArray(wallPollOptions.postId, postIds))
      .orderBy(wallPollOptions.position);
    for (const r of rows) {
      const list = map.get(r.postId) ?? [];
      list.push(r);
      map.set(r.postId, list);
    }
    return map;
  },

  async getPollOption(optionId: string): Promise<WallPollOptionRow | null> {
    const rows = await db
      .select()
      .from(wallPollOptions)
      .where(eq(wallPollOptions.id, optionId))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Cast or change a poll vote; maintains per-option vote counts. */
  async votePoll(postId: string, userId: string, optionId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const existing = await tx
        .select({ optionId: wallPollVotes.optionId })
        .from(wallPollVotes)
        .where(and(eq(wallPollVotes.postId, postId), eq(wallPollVotes.userId, userId)))
        .limit(1);
      const prev = existing[0]?.optionId;
      if (prev === optionId) return; // no change
      if (prev) {
        await tx
          .update(wallPollOptions)
          .set({ voteCount: sql`greatest(${wallPollOptions.voteCount} - 1, 0)` })
          .where(eq(wallPollOptions.id, prev));
        await tx
          .update(wallPollVotes)
          .set({ optionId, createdAt: new Date() })
          .where(and(eq(wallPollVotes.postId, postId), eq(wallPollVotes.userId, userId)));
      } else {
        await tx.insert(wallPollVotes).values({ postId, userId, optionId });
      }
      await tx
        .update(wallPollOptions)
        .set({ voteCount: sql`${wallPollOptions.voteCount} + 1` })
        .where(eq(wallPollOptions.id, optionId));
    });
  },

  async myPollVotes(userId: string, postIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (postIds.length === 0) return map;
    const rows = await db
      .select({ postId: wallPollVotes.postId, optionId: wallPollVotes.optionId })
      .from(wallPollVotes)
      .where(and(eq(wallPollVotes.userId, userId), inArray(wallPollVotes.postId, postIds)));
    for (const r of rows) map.set(r.postId, r.optionId);
    return map;
  },

  async listPostsByAuthor(
    authorId: string,
    cursor?: string,
    limit: number = 20,
  ): Promise<WallPostRow[]> {
    const conditions = [
      eq(wallPosts.authorId, authorId),
      eq(wallPosts.status, 'visible'),
      isNull(wallPosts.deletedAt),
    ];
    if (cursor) conditions.push(lt(wallPosts.createdAt, new Date(cursor)));
    return db
      .select()
      .from(wallPosts)
      .where(and(...conditions))
      .orderBy(desc(wallPosts.createdAt))
      .limit(limit);
  },

  // --- Trending materialization (background job, §10.8) ---
  async recomputeTrending(): Promise<number> {
    // Time-decayed score from engagement + recency, recent visible posts only.
    const result = await db.execute(sql`
      with scored as (
        select id, university_id,
          (reaction_count * 3 + reply_count * 5)
          / power((extract(epoch from (now() - created_at)) / 3600.0) + 2, 1.5) as score
        from wall_posts
        where status = 'visible' and deleted_at is null
          and created_at > now() - interval '7 days'
      )
      insert into trending_posts (post_id, university_id, score, computed_at)
      select id, university_id, greatest(round(score * 1000)::int, 0), now()
      from scored
      on conflict (post_id) do update set score = excluded.score, computed_at = now()
    `);
    // Drop stale rows whose posts are no longer eligible.
    await db.execute(sql`
      delete from trending_posts t
      where not exists (
        select 1 from wall_posts p
        where p.id = t.post_id and p.status = 'visible' and p.deleted_at is null
          and p.created_at > now() - interval '7 days'
      )
    `);
    return (result as unknown as { count?: number }).count ?? 0;
  },
};

// --- internal helpers ---
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function applyReactionDelta(
  tx: Tx,
  targetType: ReactionTargetType,
  targetId: string,
  delta: number,
): Promise<void> {
  if (targetType === 'wall_post') {
    await tx
      .update(wallPosts)
      .set({ reactionCount: sql`greatest(${wallPosts.reactionCount} + ${delta}, 0)` })
      .where(eq(wallPosts.id, targetId));
  } else {
    await tx
      .update(wallReplies)
      .set({ reactionCount: sql`greatest(${wallReplies.reactionCount} + ${delta}, 0)` })
      .where(eq(wallReplies.id, targetId));
  }
}

async function readReactionCount(
  tx: Tx,
  targetType: ReactionTargetType,
  targetId: string,
): Promise<number> {
  if (targetType === 'wall_post') {
    const rows = await tx
      .select({ c: wallPosts.reactionCount })
      .from(wallPosts)
      .where(eq(wallPosts.id, targetId))
      .limit(1);
    return rows[0]?.c ?? 0;
  }
  const rows = await tx
    .select({ c: wallReplies.reactionCount })
    .from(wallReplies)
    .where(eq(wallReplies.id, targetId))
    .limit(1);
  return rows[0]?.c ?? 0;
}
