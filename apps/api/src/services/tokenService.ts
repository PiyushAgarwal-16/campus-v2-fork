import jwt from 'jsonwebtoken';
import type { AccessTokenClaims } from '@campusly/shared-types';
import { config } from '../config/env.js';
import { generateOpaqueToken, sha256 } from '../lib/crypto.js';
import { refreshTokenRepository } from '../repositories/refreshTokenRepository.js';
import { UnauthorizedError } from '../domain/errors.js';

/**
 * Token service (AUTH_SYSTEM.md §5).
 *
 * - Access tokens: stateless, short-lived JWTs carrying identity + RBAC claims;
 *   validated on every REST request and socket handshake.
 * - Refresh tokens: high-entropy OPAQUE tokens stored only as SHA-256 hashes,
 *   rotated on each use and individually revocable. The raw token is returned
 *   to the client once and never persisted in the clear.
 */

const ISSUER = 'campusly';

export const tokenService = {
  signAccessToken(claims: AccessTokenClaims): string {
    return jwt.sign(claims, config.JWT_ACCESS_SECRET, {
      issuer: ISSUER,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    });
  },

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      const decoded = jwt.verify(token, config.JWT_ACCESS_SECRET, { issuer: ISSUER });
      if (typeof decoded === 'string') throw new Error('Unexpected token payload');
      const { sub, role, status, universityId } = decoded as jwt.JwtPayload &
        Partial<AccessTokenClaims>;
      if (!sub || !role || !status || !universityId) {
        throw new Error('Missing required claims');
      }
      return { sub, role, status, universityId };
    } catch {
      throw new UnauthorizedError('Your session token is invalid or has expired.');
    }
  },

  /** Issues a new refresh token for a user, persisting only its hash. */
  async issueRefreshToken(userId: string): Promise<string> {
    const raw = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    await refreshTokenRepository.create({ userId, tokenHash: sha256(raw), expiresAt });
    return raw;
  },

  /**
   * Rotates a refresh token: validates the presented token, revokes it, and
   * issues a fresh one (refresh-token rotation). Returns the owning userId and
   * the new raw refresh token. Rejects expired/revoked/unknown tokens.
   */
  async rotateRefreshToken(rawToken: string): Promise<{ userId: string; refreshToken: string }> {
    const existing = await refreshTokenRepository.findActiveByHash(sha256(rawToken));
    if (!existing || existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('Your session has expired. Please sign in again.');
    }
    const newRaw = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
    const created = await refreshTokenRepository.create({
      userId: existing.userId,
      tokenHash: sha256(newRaw),
      expiresAt,
    });
    await refreshTokenRepository.revokeById(existing.id, created.id);
    return { userId: existing.userId, refreshToken: newRaw };
  },

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const existing = await refreshTokenRepository.findActiveByHash(sha256(rawToken));
    if (existing) await refreshTokenRepository.revokeById(existing.id);
  },
};
