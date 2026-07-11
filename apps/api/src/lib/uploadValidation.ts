import { MEDIA_CONSTRAINTS, type MediaKind } from '@campusly/shared-types';

/**
 * Upload content validation (SECURITY.md — file-upload hardening). The client
 * only DECLARES its mime/size when requesting a signed URL; the bytes it later
 * PUTs must be validated for real before they touch our disk/object storage.
 * This module inspects the actual bytes to:
 *   1. enforce the true size against the per-kind cap (disk-exhaustion defense),
 *   2. confirm the content really is the type it claims via magic-byte sniffing
 *      (blocks disguised files), and
 *   3. reject dangerous payloads (executables, scripts, HTML/SVG) outright.
 */

/** Detect a supported image type from its magic bytes, or null. */
export function sniffImageMime(
  buf: Buffer,
): 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WEBP: "RIFF"????"WEBP"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  // GIF: "GIF87a" / "GIF89a"
  const gif = buf.toString('ascii', 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif';
  return null;
}

/** Signatures/markers we never accept regardless of the declared kind. */
function looksDangerous(buf: Buffer): boolean {
  // Windows PE (MZ) and Linux ELF executables.
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return true;
  if (buf.length >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    return true;
  }
  // Textual script / markup that a browser or shell could execute.
  const head = buf.toString('utf8', 0, Math.min(buf.length, 512)).toLowerCase();
  if (head.startsWith('#!')) return true; // shebang script
  return (
    head.includes('<?php') ||
    head.includes('<script') ||
    head.includes('<!doctype html') ||
    head.includes('<html') ||
    head.includes('<svg') // SVG can embed active script
  );
}

export interface ContentValidationResult {
  ok: boolean;
  reason?: string;
  /** true when the failure is specifically an oversize file (maps to HTTP 413). */
  tooLarge?: boolean;
}

/**
 * Validate uploaded bytes against the declared media kind before persisting.
 * Positive allowlist by content, not by the client's claimed mime.
 */
export function validateUploadContent(
  kind: MediaKind,
  buf: Buffer,
  declaredMime: string,
): ContentValidationResult {
  const constraint = MEDIA_CONSTRAINTS[kind];
  if (buf.length === 0) return { ok: false, reason: 'Empty file.' };
  if (buf.length > constraint.maxBytes) {
    return { ok: false, reason: 'File exceeds the allowed size.', tooLarge: true };
  }
  if (looksDangerous(buf)) return { ok: false, reason: 'File content is not allowed.' };

  if (kind === 'image' || kind === 'avatar') {
    const sniffed = sniffImageMime(buf);
    if (!sniffed || !constraint.allowedMimes.includes(sniffed)) {
      return { ok: false, reason: 'File is not a valid image.' };
    }
    return { ok: true };
  }

  if (kind === 'document') {
    if (buf.toString('ascii', 0, 5) !== '%PDF-') {
      return { ok: false, reason: 'File is not a valid PDF.' };
    }
    return { ok: true };
  }

  // voice / video: mime is allowlisted at sign time; here enforce size + the
  // dangerous-content check above, and confirm the declared mime is permitted.
  if (!constraint.allowedMimes.includes(declaredMime)) {
    return { ok: false, reason: 'Unsupported file type.' };
  }
  return { ok: true };
}
