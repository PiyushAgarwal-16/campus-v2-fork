import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type {
  ChatAttachment,
  InspectedMediaMeta,
  InspectedPost,
  MessageContextType,
  TranscriptMessage,
} from '@campusly/shared-types';
import { db } from '../db/client.js';
import {
  communityPosts,
  mediaAssets,
  messageAttachments,
  messages,
  postMedia,
  wallPosts,
  type CommunityPostRow,
  type MediaAssetRow,
  type MessageRow,
  type WallPostRow,
} from '../db/schema.js';

/**
 * Read-only data access for the Data_Inspector (ADMIN_PANEL.md, Requirement 8).
 *
 * INVIOLABLE RULE: every query in this module is READ-ONLY. It performs no
 * INSERT / UPDATE / DELETE of any kind. Authorization and audit-logging are the
 * service layer's responsibility (Data_Inspector service, task 6.2) — this layer
 * only reads and maps rows toward the shared inspection DTOs.
 *
 * Cursor convention matches the rest of the codebase (e.g. `wallRepository.feedLatest`,
 * `notificationRepository.list`): a `created_at` ISO-string cursor plus a `limit`,
 * newest-first. The repository returns rows; the service computes `nextCursor`.
 *
 * Purged / removed records are represented with a tombstone marker
 * (`contentUnavailable: true`) rather than being omitted silently (Req 8.6).
 */

/** Default and hard cap for a scoped conversation inspection window (Req 8.3). */
const DEFAULT_CONVERSATION_WINDOW = 25;
const MAX_CONVERSATION_WINDOW = 50;

export const dataInspectorRepository = {
  /**
   * Cursor-paginated wall posts mapped toward `InspectedPost` (Req 8.1). Removed
   * posts are returned as tombstones with redacted body/media rather than hidden.
   */
  async listWallPosts(input: { cursor?: string; limit: number }): Promise<InspectedPost[]> {
    const conditions = input.cursor ? [lt(wallPosts.createdAt, new Date(input.cursor))] : [];
    const rows = await db
      .select()
      .from(wallPosts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(wallPosts.createdAt))
      .limit(input.limit);

    const mediaByPost = await mediaIdsForWallPosts(rows);
    return rows.map((row) => mapWallPost(row, mediaByPost.get(row.id) ?? []));
  },

  /**
   * Cursor-paginated community posts mapped toward `InspectedPost` (Req 8.1).
   * Community posts carry no media attachments, so `mediaIds` is always empty.
   */
  async listCommunityPosts(input: { cursor?: string; limit: number }): Promise<InspectedPost[]> {
    const conditions = input.cursor ? [lt(communityPosts.createdAt, new Date(input.cursor))] : [];
    const rows = await db
      .select()
      .from(communityPosts)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(communityPosts.createdAt))
      .limit(input.limit);

    return rows.map(mapCommunityPost);
  },

  /**
   * Cursor-paginated media metadata mapped toward `InspectedMediaMeta` (Req 8.1).
   * Bytes are never returned here; deleted assets are tombstoned (Req 8.5, 8.6).
   */
  async listMedia(input: { cursor?: string; limit: number }): Promise<InspectedMediaMeta[]> {
    const conditions = input.cursor ? [lt(mediaAssets.createdAt, new Date(input.cursor))] : [];
    const rows = await db
      .select()
      .from(mediaAssets)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(mediaAssets.createdAt))
      .limit(input.limit);

    return rows.map(mapMedia);
  },

  /**
   * A bounded window of messages for scoped conversation inspection (Req 8.3),
   * mapped toward `TranscriptMessage`. When `aroundMessageId` is provided the
   * window is centred on that message (which is flagged `isReported`); otherwise
   * the most recent messages are returned. The window size is bounded to at most
   * {@link MAX_CONVERSATION_WINDOW} messages. READ-ONLY: no authorization or audit
   * is performed here — that is the service's responsibility (task 6.2).
   */
  async readConversationWindow(input: {
    contextType: MessageContextType;
    conversationId: string;
    aroundMessageId?: string;
    limit?: number;
  }): Promise<TranscriptMessage[]> {
    const limit = clampWindow(input.limit);
    const contextColumn =
      input.contextType === 'anon_session' ? messages.sessionId : messages.friendshipId;
    const scope = and(
      eq(messages.contextType, input.contextType),
      eq(contextColumn, input.conversationId),
    );

    const rows = input.aroundMessageId
      ? await selectWindowAround(scope, input.aroundMessageId, limit)
      : await selectLatestWindow(scope, limit);

    const attachments = await attachmentsForMessages(rows.map((r) => r.id));
    return rows.map((row) =>
      mapTranscriptMessage(row, attachments.get(row.id) ?? null, row.id === input.aroundMessageId),
    );
  },
};

// --- internal read helpers (READ-ONLY) --------------------------------------

/** Media ids attached to the given wall posts, keyed by post id (reuses postMedia). */
async function mediaIdsForWallPosts(rows: WallPostRow[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const postIds = rows.filter((r) => !isPostTombstoned(r)).map((r) => r.id);
  if (postIds.length === 0) return map;
  const media = await db
    .select({ postId: postMedia.postId, mediaId: postMedia.mediaId, position: postMedia.position })
    .from(postMedia)
    .where(inArray(postMedia.postId, postIds))
    .orderBy(postMedia.position);
  for (const m of media) {
    const list = map.get(m.postId) ?? [];
    list.push(m.mediaId);
    map.set(m.postId, list);
  }
  return map;
}

/** Latest `limit` messages in a conversation, returned oldest-first. */
async function selectLatestWindow(
  scope: ReturnType<typeof and>,
  limit: number,
): Promise<MessageRow[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(scope)
    .orderBy(desc(messages.createdAt))
    .limit(limit);
  return rows.reverse();
}

/**
 * A window centred on `aroundMessageId`: some older messages, the anchor, and some
 * newer messages, bounded to `limit` total and returned oldest-first. Falls back to
 * the latest window when the anchor is not found in this conversation.
 */
async function selectWindowAround(
  scope: ReturnType<typeof and>,
  aroundMessageId: string,
  limit: number,
): Promise<MessageRow[]> {
  const anchorRows = await db
    .select({ createdAt: messages.createdAt })
    .from(messages)
    .where(and(scope, eq(messages.id, aroundMessageId)))
    .limit(1);
  const anchor = anchorRows[0];
  if (!anchor) return selectLatestWindow(scope, limit);

  const olderCount = Math.floor((limit - 1) / 2);
  const older = await db
    .select()
    .from(messages)
    .where(and(scope, lt(messages.createdAt, anchor.createdAt)))
    .orderBy(desc(messages.createdAt))
    .limit(olderCount);

  const anchorAndNewer = await db
    .select()
    .from(messages)
    .where(and(scope, gte(messages.createdAt, anchor.createdAt)))
    .orderBy(asc(messages.createdAt))
    .limit(limit - older.length);

  return [...older.reverse(), ...anchorAndNewer];
}

/** Attachment media rows for a set of messages, keyed by message id. */
async function attachmentsForMessages(messageIds: string[]): Promise<Map<string, MediaAssetRow>> {
  const map = new Map<string, MediaAssetRow>();
  if (messageIds.length === 0) return map;
  const rows = await db
    .select({ messageId: messageAttachments.messageId, media: mediaAssets })
    .from(messageAttachments)
    .innerJoin(mediaAssets, eq(mediaAssets.id, messageAttachments.mediaId))
    .where(inArray(messageAttachments.messageId, messageIds));
  for (const r of rows) map.set(r.messageId, r.media);
  return map;
}

// --- pure mappers -----------------------------------------------------------

/** A wall/community post is a tombstone once removed or soft-deleted (Req 8.6). */
function isPostTombstoned(row: WallPostRow | CommunityPostRow): boolean {
  return row.status === 'removed' || row.deletedAt !== null;
}

function mapWallPost(row: WallPostRow, mediaIds: string[]): InspectedPost {
  const tombstoned = isPostTombstoned(row);
  return {
    id: row.id,
    kind: 'wall_post',
    authorId: row.isAnonymous ? null : row.authorId,
    isAnonymous: row.isAnonymous,
    body: tombstoned ? null : row.body,
    status: row.status,
    mediaIds: tombstoned ? [] : mediaIds,
    createdAt: row.createdAt.toISOString(),
    ...(tombstoned ? { contentUnavailable: true } : {}),
  };
}

function mapCommunityPost(row: CommunityPostRow): InspectedPost {
  const tombstoned = isPostTombstoned(row);
  return {
    id: row.id,
    kind: 'community_post',
    authorId: row.isAnonymous ? null : row.authorId,
    isAnonymous: row.isAnonymous,
    body: tombstoned ? null : row.body,
    status: row.status,
    mediaIds: [],
    createdAt: row.createdAt.toISOString(),
    ...(tombstoned ? { contentUnavailable: true } : {}),
  };
}

function mapMedia(row: MediaAssetRow): InspectedMediaMeta {
  const tombstoned = row.status === 'deleted';
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mimeType,
    status: row.status,
    durationMs: row.durationMs,
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    ...(tombstoned ? { contentUnavailable: true } : {}),
  };
}

function mapAttachment(media: MediaAssetRow): ChatAttachment {
  return {
    mediaId: media.id,
    kind: media.kind,
    mimeType: media.mimeType,
    durationMs: media.durationMs,
    expiresAt: media.expiresAt ? media.expiresAt.toISOString() : null,
  };
}

function mapTranscriptMessage(
  row: MessageRow,
  media: MediaAssetRow | null,
  isReported: boolean,
): TranscriptMessage {
  return {
    id: row.id,
    senderId: row.senderId,
    type: row.type,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    attachment: media ? mapAttachment(media) : null,
    ...(isReported ? { isReported: true } : {}),
  };
}

function clampWindow(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_CONVERSATION_WINDOW;
  if (!Number.isFinite(limit) || limit <= 0) return DEFAULT_CONVERSATION_WINDOW;
  return Math.min(Math.floor(limit), MAX_CONVERSATION_WINDOW);
}
