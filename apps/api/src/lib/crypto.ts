import { createHash, randomBytes } from 'node:crypto';

/**
 * Small crypto helpers (SECURITY.md §4, §9).
 * - Refresh tokens and IPs are stored only as hashes, never in the clear.
 */

/** Generates a high-entropy opaque token (used as the refresh-token secret). */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hash (hex) — used for refresh-token storage and IP hashing. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
