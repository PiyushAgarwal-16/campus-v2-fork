import type { RequestHandler, Request } from 'express';
import { BLOCKED_LOGIN_STATUSES, type AccessTokenClaims } from '@campusly/shared-types';
import { tokenService } from '../services/tokenService.js';
import { AuthenticationError, ForbiddenError } from '../domain/errors.js';

/**
 * Authentication middleware (AUTH_SYSTEM.md §4, SECURITY.md §3).
 * Validates the Bearer access token on every protected request and attaches
 * the verified claims to `req.auth`. Fails closed — the client is never trusted.
 */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw new AuthenticationError('Missing authentication token.');
  }
  const token = header.slice('Bearer '.length).trim();
  const claims = tokenService.verifyAccessToken(token); // throws UnauthorizedError if invalid

  // Defense in depth: reject tokens carrying a blocked status (short TTL bounds staleness).
  if (BLOCKED_LOGIN_STATUSES.includes(claims.status)) {
    throw new ForbiddenError('This account is not permitted to access Campusly.');
  }

  req.auth = claims;
  next();
};

/**
 * Reads the verified claims attached by `requireAuth`. Throws if absent (which
 * indicates a route was not guarded) — avoids non-null assertions in handlers.
 */
export function getAuth(req: Request): AccessTokenClaims {
  if (!req.auth) throw new AuthenticationError('Authentication required.');
  return req.auth;
}
