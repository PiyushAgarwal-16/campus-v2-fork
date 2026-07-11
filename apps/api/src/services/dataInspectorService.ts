import type {
  AccessTokenClaims,
  AdminUser,
  AuditLogItem,
  ConversationTranscript,
  InspectConversationInput,
  InspectedMediaMeta,
  InspectedPost,
} from '@campusly/shared-types';
import { MODERATOR_ROLES } from '@campusly/shared-types';
import { config } from '../config/env.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { dataInspectorRepository } from '../repositories/dataInspectorRepository.js';
import { mediaRepository } from '../repositories/mediaRepository.js';
import { moderationRepository } from '../repositories/moderationRepository.js';
import { storage } from '../storage/index.js';
import { adminService } from './adminService.js';

/**
 * Data_Inspector service (ADMIN_PANEL.md, Requirement 8).
 *
 * Exposes READ-ONLY, cursor-paginated inspection surfaces over users, posts,
 * media metadata, and the audit log, plus the one privileged inspection surface
 * `inspectConversation` (task 6.2): a scoped, moderator-only, audited transcript
 * read. The read surfaces perform no mutation; authorization for them is enforced
 * by the Authorization_Guard at the route layer. `inspectConversation` re-checks
 * the moderator role and resolving scope here for defense-in-depth and writes the
 * required audit entry. `signMediaUrl` (task 6.3) issues short-lived signed
 * media URLs by delegating to the shared media/object-storage subsystem, never
 * exposing a permanent public URL (Req 8.5).
 *
 * Pagination follows the rest of the codebase (e.g. `adminService.listUsers`,
 * `notificationService.list`, `wallService.feed`): a `created_at` ISO-string
 * cursor plus a bounded `limit`, newest-first. The repositories return rows;
 * this service computes `nextCursor` from the last row when a full page was
 * returned. Limit bounds are enforced here at the service layer.
 *
 * Tombstones (`contentUnavailable`) produced by the repository for removed or
 * purged records are surfaced as-is and never dropped (Req 8.6).
 */

/** Default and hard cap for inspection page sizes (design: default 50, max 100). */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** A cursor-paginated slice of inspection records. */
export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

/** Query for the paginated user inspection surface (Req 8.1). */
export interface InspectorUserQuery {
  q?: string;
  cursor?: string;
  limit?: number;
}

/** Query for the paginated post/media inspection surfaces (Req 8.1). */
export interface InspectorListQuery {
  cursor?: string;
  limit?: number;
}

class DataInspectorService {
  /**
   * Cursor-paginated user records (Req 8.1). Reuses `adminService.listUsers`,
   * which maps `UserRow → AdminUser` and computes `nextCursor` with the same
   * convention used across admin surfaces; this method only bounds the limit
   * and re-shapes the result into the shared `Paginated` envelope.
   */
  async listUsers(query: InspectorUserQuery): Promise<Paginated<AdminUser>> {
    const limit = clampLimit(query.limit);
    const { users, nextCursor } = await adminService.listUsers(query.q, query.cursor, limit);
    return { items: users, nextCursor };
  }

  /** Cursor-paginated wall posts mapped to `InspectedPost` (Req 8.1). */
  async listWallPosts(query: InspectorListQuery): Promise<Paginated<InspectedPost>> {
    const limit = clampLimit(query.limit);
    const items = await dataInspectorRepository.listWallPosts({ cursor: query.cursor, limit });
    return { items, nextCursor: nextCursorFrom(items, limit) };
  }

  /** Cursor-paginated community posts mapped to `InspectedPost` (Req 8.1). */
  async listCommunityPosts(query: InspectorListQuery): Promise<Paginated<InspectedPost>> {
    const limit = clampLimit(query.limit);
    const items = await dataInspectorRepository.listCommunityPosts({ cursor: query.cursor, limit });
    return { items, nextCursor: nextCursorFrom(items, limit) };
  }

  /** Cursor-paginated media metadata mapped to `InspectedMediaMeta` (Req 8.1). */
  async listMedia(query: InspectorListQuery): Promise<Paginated<InspectedMediaMeta>> {
    const limit = clampLimit(query.limit);
    const items = await dataInspectorRepository.listMedia({ cursor: query.cursor, limit });
    return { items, nextCursor: nextCursorFrom(items, limit) };
  }

  /**
   * Cursor-paginated audit log in reverse-chronological order (Req 8.2). Reuses
   * `adminService.auditLogs`, which reads `moderationRepository.listAudit`, maps
   * rows to `AuditLogItem`, and computes `nextCursor`; this method only bounds
   * the limit and re-shapes into the shared `Paginated` envelope.
   */
  async listAudit(cursor: string | undefined, limit: number): Promise<Paginated<AuditLogItem>> {
    const bounded = clampLimit(limit);
    const { logs, nextCursor } = await adminService.auditLogs(cursor, bounded);
    return { items: logs, nextCursor };
  }

  /**
   * Scoped, moderator-only, audited conversation inspection (Req 8.3, 8.4). This
   * is the single privileged (mutating, via audit write) surface on the
   * otherwise read-only inspector, and is never open browsing:
   *
   *  1. ROLE GATE (defense-in-depth). The operator's role must be in
   *     {@link MODERATOR_ROLES}; otherwise {@link ForbiddenError}. The route
   *     guard also enforces this, but re-checking here keeps the invariant true
   *     regardless of caller and satisfies the moderator-only property.
   *  2. SCOPE GATE. A resolving `reportId` OR `investigationContext` must be
   *     present; otherwise {@link ValidationError}. `InspectConversationSchema`
   *     refines the same rule at the edge, but guarding again means the service
   *     never reads a conversation without a resolving scope.
   *  3. BOUNDED READ. The transcript window is read via the read-only
   *     `dataInspectorRepository.readConversationWindow` (task 3.2); no query is
   *     duplicated here.
   *  4. EXACTLY ONE AUDIT. On each successful inspection, exactly one
   *     `inspection.conversation` `audit_logs` entry is written via the existing
   *     `moderationRepository.writeAudit`, recording the actor (`claims.sub`),
   *     the conversation key (contextType + conversationId as the target), and
   *     the associated report/investigation in metadata (Req 8.4).
   *
   * A conversation with no messages (never existed or purged under retention) is
   * surfaced as `contentUnavailable: true` with an empty `messages` array rather
   * than throwing (Req 8.6).
   */
  async inspectConversation(
    claims: AccessTokenClaims,
    input: InspectConversationInput,
  ): Promise<ConversationTranscript> {
    // (1) Role gate — moderator-only, enforced independently of the route guard.
    if (!MODERATOR_ROLES.includes(claims.role)) {
      throw new ForbiddenError('Conversation inspection requires a moderator role.');
    }

    // (2) Scope gate — a resolving report or investigation context is required;
    // inspection is never open browsing.
    const reportId = input.reportId ?? null;
    const hasScope = reportId !== null || Boolean(input.investigationContext);
    if (!hasScope) {
      throw new ValidationError('A resolving report or investigation context is required.');
    }

    // (3) Bounded read via the read-only repository (no duplicate query).
    const messages = await dataInspectorRepository.readConversationWindow({
      contextType: input.contextType,
      conversationId: input.conversationId,
    });

    // (4) Exactly one audit entry per successful inspection (Req 8.4). Records the
    // actor, the conversation key (target), and the associated report/investigation.
    await moderationRepository.writeAudit({
      actorId: claims.sub,
      action: 'inspection.conversation',
      targetType: input.contextType,
      targetId: input.conversationId,
      metadata: {
        reportId,
        ...(input.investigationContext ? { investigationContext: input.investigationContext } : {}),
      },
    });

    const contentUnavailable = messages.length === 0;
    return {
      contextType: input.contextType,
      conversationId: input.conversationId,
      messages,
      reportId,
      ...(contentUnavailable ? { contentUnavailable: true } : {}),
    };
  }

  /**
   * Issue a SHORT-LIVED signed URL for a media asset so an operator can inspect
   * the bytes without ever exposing a permanent public URL (Req 8.5).
   *
   * This never mints its own URL: it delegates to the same media subsystem the
   * rest of the app uses. It looks up the asset reference, treats a
   * missing/purged asset (never existed, `deleted`, or `expired` under
   * retention) as {@link NotFoundError} — mirroring `mediaService.getDownloadUrl`
   * — and then hands the storage key to the active object-storage driver's
   * signer (`storage.getDownloadUrl`, the `local` HMAC-token driver in dev, a
   * real presigner in production). The URL that signer returns is time-bounded
   * by `MEDIA_URL_TTL_SECONDS`; `expiresAt` is the matching future ISO timestamp,
   * computed exactly as `mediaService` does so the two never diverge.
   *
   * Note this deliberately does NOT run the participant/owner access check in
   * `mediaService.getDownloadUrl`: authorization for the inspector surface is the
   * Admin tier enforced by the Authorization_Guard at the route layer, not media
   * ownership. The signer, and thus the enforced expiry, is identical.
   */
  async signMediaUrl(
    _claims: AccessTokenClaims,
    mediaId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const media = await mediaRepository.findById(mediaId);
    if (!media || media.status === 'deleted' || media.status === 'expired') {
      throw new NotFoundError('Media not found.');
    }

    const url = await storage.getDownloadUrl(media.storageKey, media.mimeType);
    return {
      url,
      expiresAt: new Date(Date.now() + config.MEDIA_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }
}

export const dataInspectorService = new DataInspectorService();

// --- pagination helpers (shared with tasks 6.2/6.3 as they are added) --------

/** Bound a requested page size to `[1, MAX_LIMIT]`, defaulting when absent. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit) || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

/**
 * Compute the next cursor from a page of already-mapped inspection records: the
 * last record's `createdAt` when a full page was returned, else `null`. The DTOs
 * carry `createdAt` as an ISO string, so it is used directly as the cursor.
 */
function nextCursorFrom(items: { createdAt: string }[], limit: number): string | null {
  return items.length === limit ? (items[items.length - 1]?.createdAt ?? null) : null;
}
