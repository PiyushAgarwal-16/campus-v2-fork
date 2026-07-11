import { randomUUID } from 'node:crypto';
import type { AccessTokenClaims, MediaRef, UploadUrlRequest } from '@campusly/shared-types';
import { MEDIA_CONSTRAINTS, MEDIA_SERVER_EVENTS, UPLOADABLE_KINDS } from '@campusly/shared-types';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import type { MediaAssetRow } from '../db/schema.js';
import { mediaRepository } from '../repositories/mediaRepository.js';
import { messagingRepository } from '../repositories/messagingRepository.js';
import { messagingService } from './messagingService.js';
import { userRepository } from '../repositories/userRepository.js';
import { storage } from '../storage/index.js';
import { notifier } from '../realtime/notifier.js';

/**
 * Media pipeline (MEDIA_SYSTEM.md, ARCHITECTURE.md §9). Issues signed upload
 * URLs after server-side validation, registers references, gates downloads
 * behind authorization, and expires temporary media (~48h). Bytes live in
 * object storage; only references live in PostgreSQL.
 */

const SWEEP_INTERVAL_MS = 60_000;
const PENDING_ORPHAN_MS = 60 * 60 * 1000; // unconfirmed uploads reclaimed after 1h

function tempTtlMs(): number {
  return config.MEDIA_TEMP_TTL_HOURS * 60 * 60 * 1000;
}

function toRef(row: MediaAssetRow): MediaRef {
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mimeType,
    durationMs: row.durationMs,
    isTemporary: row.isTemporary,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    status: row.status,
  };
}

class MediaService {
  private sweeper: NodeJS.Timeout | null = null;

  /** Validate constraints, create a pending reference, and sign an upload URL. */
  async requestUploadUrl(
    ownerId: string,
    input: UploadUrlRequest,
  ): Promise<{
    media: MediaRef;
    upload: { method: 'PUT'; url: string; headers: Record<string, string> };
  }> {
    // Security hardening: only images (file uploads) + recorded voice are
    // permitted. Video/document uploads are rejected outright.
    if (!UPLOADABLE_KINDS.includes(input.kind)) {
      throw new ValidationError('This file type cannot be uploaded.');
    }
    const constraint = MEDIA_CONSTRAINTS[input.kind];
    if (!constraint.allowedMimes.includes(input.mimeType)) {
      throw new ValidationError(`Unsupported file type for ${input.kind}.`);
    }
    if (input.sizeBytes > constraint.maxBytes) {
      throw new ValidationError('File is too large.');
    }
    if (
      constraint.maxDurationMs &&
      input.durationMs &&
      input.durationMs > constraint.maxDurationMs
    ) {
      throw new ValidationError('Recording is too long.');
    }

    // Chat media is temporary by default; avatars/documents are persistent.
    // If input explicitly overrides isTemporary (e.g. Wall images are persistent), respect it.
    const isTemporary = input.isTemporary ?? input.kind !== 'avatar';
    const storageKey = `${input.kind}/${randomUUID()}`;

    const media = await mediaRepository.createPending({
      ownerId,
      storageKey,
      kind: input.kind,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      durationMs: input.durationMs,
      isTemporary,
    });

    const upload = await storage.createUploadUrl(storageKey, input.mimeType);
    return { media: toRef(media), upload };
  }

  /** Confirm an upload completed: activate the asset and set temporary expiry. */
  async confirmUpload(ownerId: string, mediaId: string): Promise<MediaRef> {
    const media = await mediaRepository.findById(mediaId);
    if (!media) throw new NotFoundError('Media not found.');
    if (media.ownerId !== ownerId) throw new ForbiddenError('You do not own this media.');
    if (media.status !== 'pending') return toRef(media); // idempotent
    const expiresAt = media.isTemporary ? new Date(Date.now() + tempTtlMs()) : null;
    const activated = await mediaRepository.activate(mediaId, expiresAt);
    if (!activated) throw new NotFoundError('Media not found.');
    return toRef(activated);
  }

  /** Issue a short-lived, access-checked signed download URL. */
  async getDownloadUrl(
    claims: AccessTokenClaims,
    mediaId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    const media = await mediaRepository.findById(mediaId);
    if (!media || media.status === 'deleted') throw new NotFoundError('Media not found.');
    if (media.status === 'expired') throw new NotFoundError('This media has expired.');
    if (!(await this.canAccess(claims, media))) {
      throw new ForbiddenError('You do not have access to this media.');
    }
    const url = await storage.getDownloadUrl(media.storageKey, media.mimeType);
    return {
      url,
      expiresAt: new Date(Date.now() + config.MEDIA_URL_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Delete own media: purge bytes and mark the reference deleted. */
  async deleteMedia(ownerId: string, mediaId: string): Promise<void> {
    const media = await mediaRepository.findById(mediaId);
    if (!media) throw new NotFoundError('Media not found.');
    if (media.ownerId !== ownerId) throw new ForbiddenError('You do not own this media.');
    await storage
      .deleteObject(media.storageKey)
      .catch((err) => logger.error({ err }, 'media delete'));
    await mediaRepository.markStatus(mediaId, 'deleted');
    await this.notifyMediaGone(media, MEDIA_SERVER_EVENTS.MEDIA_DELETED);
  }

  /**
   * Authorization for media access (MEDIA_SYSTEM.md §4, §9): the owner always;
   * avatars to same-campus students; chat media only to context participants.
   */
  private async canAccess(claims: AccessTokenClaims, media: MediaAssetRow): Promise<boolean> {
    if (media.ownerId === claims.sub) return true;

    if (media.kind === 'avatar') {
      if (!media.ownerId) return false;
      const owner = await userRepository.findById(media.ownerId);
      return Boolean(owner && owner.universityId === claims.universityId);
    }

    // Chat media: must participate in a context the media is attached to.
    const messageIds = await mediaRepository.messageIdsForMedia(media.id);
    for (const messageId of messageIds) {
      const context = await messagingRepository.findContextByMessageId(messageId);
      if (
        context &&
        (await messagingService.authorize(claims.sub, context.contextType, context.contextId))
      ) {
        return true;
      }
    }

    // Wall media: check if the media is attached to a wall post from the user's university.
    const universityIds = await mediaRepository.universityIdsForMedia(media.id);
    if (universityIds.length > 0) {
      return universityIds.includes(claims.universityId);
    }

    return false;
  }

  /** Emit an expiry/deletion notification to each context the media appears in. */
  private async notifyMediaGone(media: MediaAssetRow, event: string): Promise<void> {
    const messageIds = await mediaRepository.messageIdsForMedia(media.id);
    for (const messageId of messageIds) {
      const context = await messagingRepository.findContextByMessageId(messageId);
      if (!context) continue;
      const recipients = await messagingService.recipients(context.contextType, context.contextId);
      for (const uid of recipients) {
        notifier.emitToUser(uid, event, { messageId, mediaId: media.id });
      }
    }
  }

  /** Start the periodic cleanup of expired temporary media + orphaned uploads. */
  startCleanup(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      void this.runCleanup().catch((err) => logger.error({ err }, 'media cleanup failed'));
    }, SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
  }

  /** Stop the cleanup sweeper (graceful shutdown). Idempotent. */
  stopCleanup(): void {
    if (!this.sweeper) return;
    clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** One cleanup pass: expire+delete temporary media past deadline; reclaim orphans. */
  async runCleanup(now = new Date()): Promise<{ expired: number; orphans: number }> {
    const expired = await mediaRepository.findExpired(now);
    for (const media of expired) {
      await storage
        .deleteObject(media.storageKey)
        .catch((err) => logger.error({ err }, 'expire delete'));
      await mediaRepository.markStatus(media.id, 'expired');
      const event =
        media.kind === 'voice'
          ? MEDIA_SERVER_EVENTS.VOICE_MESSAGE_EXPIRED
          : MEDIA_SERVER_EVENTS.MEDIA_EXPIRED;
      await this.notifyMediaGone(media, event);
    }

    const orphans = await mediaRepository.findStalePending(
      new Date(now.getTime() - PENDING_ORPHAN_MS),
    );
    for (const media of orphans) {
      await storage.deleteObject(media.storageKey).catch(() => {});
      await mediaRepository.markStatus(media.id, 'deleted');
    }

    if (expired.length || orphans.length) {
      logger.info({ expired: expired.length, orphans: orphans.length }, 'Media cleanup pass');
    }
    return { expired: expired.length, orphans: orphans.length };
  }
}

export const mediaService = new MediaService();
