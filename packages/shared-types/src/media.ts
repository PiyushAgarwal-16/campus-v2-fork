import { z } from 'zod';
import { MESSAGE_CONTEXTS } from './messaging.js';

/**
 * Media system contracts (MEDIA_SYSTEM.md, DATABASE_SCHEMA.md §8.6, §20,
 * API_SPEC.md §8, SOCKET_EVENTS.md §6–7). The inviolable rule: bytes live in
 * object storage, references live in PostgreSQL — only references cross here.
 */

export const MEDIA_KINDS = ['image', 'voice', 'video', 'avatar', 'document'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_STATUSES = ['pending', 'active', 'expired', 'deleted'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/**
 * Per-kind validation, enforced server-side at signed-URL request time
 * (MEDIA_SYSTEM.md §6–9). Sizes/durations are conservative for the free tier.
 */
export interface MediaConstraint {
  allowedMimes: string[];
  maxBytes: number;
  maxDurationMs?: number;
}

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];

export const MEDIA_CONSTRAINTS: Record<MediaKind, MediaConstraint> = {
  avatar: { allowedMimes: IMAGE_MIMES, maxBytes: 8 * 1024 * 1024 },
  image: { allowedMimes: IMAGE_MIMES, maxBytes: 8 * 1024 * 1024 },
  voice: {
    allowedMimes: ['audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/mp4'],
    maxBytes: 16 * 1024 * 1024,
    maxDurationMs: 5 * 60 * 1000, // 5 minutes
  },
  video: {
    allowedMimes: ['video/mp4', 'video/webm'],
    maxBytes: 50 * 1024 * 1024,
    maxDurationMs: 60 * 1000, // 60 seconds short-form
  },
  document: { allowedMimes: ['application/pdf'], maxBytes: 16 * 1024 * 1024 },
};

/**
 * Kinds a user may upload right now (security hardening). File uploads are
 * restricted to images (regular images + avatars); `voice` is permitted only
 * for in-browser recorded audio. Video and document uploads are DISABLED
 * platform-wide (wall AND chat) so arbitrary/dangerous files can never be
 * accepted — the byte-write path additionally validates real content.
 */
export const UPLOADABLE_KINDS: MediaKind[] = ['image', 'avatar', 'voice'];

/**
 * Absolute body-size ceiling for an upload, in bytes — the largest cap among
 * the currently-uploadable kinds. Enforced at sign time AND at the byte-write
 * path so no oversized file can reach disk/storage. Per-kind caps
 * (`MEDIA_CONSTRAINTS`) are still enforced individually.
 */
export const MAX_UPLOAD_BYTES = Math.max(
  ...UPLOADABLE_KINDS.map((k) => MEDIA_CONSTRAINTS[k].maxBytes),
);

/** A media reference as returned to clients (never bytes). */
export interface MediaRef {
  id: string;
  kind: MediaKind;
  mimeType: string;
  durationMs: number | null;
  isTemporary: boolean;
  expiresAt: string | null;
  status: MediaStatus;
}

// --- REST schemas (API_SPEC.md §8) ---

/** POST /media/upload-url — request a signed upload URL (validated). */
export const UploadUrlRequestSchema = z.object({
  // Uploadable kinds only (image/avatar file uploads + recorded voice). The
  // per-kind mime allowlist is enforced server-side against the real bytes.
  kind: z.enum(['image', 'avatar', 'voice']),
  mimeType: z.string().min(1).max(128),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  durationMs: z.number().int().positive().optional(),
  isTemporary: z.boolean().optional(),
});
export type UploadUrlRequest = z.infer<typeof UploadUrlRequestSchema>;

/** Response carrying the signed upload target + the pending media reference. */
export interface UploadUrlResponse {
  media: MediaRef;
  upload: { method: 'PUT'; url: string; headers: Record<string, string> };
}

/** GET /media/:id/url — signed, access-checked download URL. */
export interface DownloadUrlResponse {
  url: string;
  expiresAt: string;
}

// --- Socket events (SOCKET_EVENTS.md §6–7) ---

export const MEDIA_CLIENT_EVENTS = {
  VOICE_UPLOAD_STARTED: 'voice_upload_started',
  VOICE_UPLOAD_COMPLETED: 'voice_upload_completed',
  MEDIA_UPLOADED: 'media_uploaded',
} as const;

export const MEDIA_SERVER_EVENTS = {
  VOICE_MESSAGE_RECEIVED: 'voice_message_received',
  VOICE_MESSAGE_EXPIRED: 'voice_message_expired',
  MEDIA_RECEIVED: 'media_received',
  MEDIA_EXPIRED: 'media_expired',
  MEDIA_DELETED: 'media_deleted',
} as const;

/** voice_upload_completed — attach a confirmed voice asset to a new message. */
export const VoiceUploadCompletedSchema = z.object({
  contextType: z.enum(MESSAGE_CONTEXTS),
  contextId: z.string().uuid(),
  mediaId: z.string().uuid(),
  durationMs: z.number().int().positive().optional(),
});
export type VoiceUploadCompletedPayload = z.infer<typeof VoiceUploadCompletedSchema>;

/** media_uploaded — attach a confirmed image/video asset to a new message. */
export const MediaUploadedSchema = z.object({
  contextType: z.enum(MESSAGE_CONTEXTS),
  contextId: z.string().uuid(),
  mediaId: z.string().uuid(),
});
export type MediaUploadedPayload = z.infer<typeof MediaUploadedSchema>;

export interface MediaExpiredPayload {
  messageId: string;
  mediaId: string;
}
