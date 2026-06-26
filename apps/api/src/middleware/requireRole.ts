import type { RequestHandler } from 'express';
import type { UserRole } from '@campusly/shared-types';
import { ForbiddenError, UnauthorizedError } from '../domain/errors.js';

/**
 * Role-based authorization (AUTH_SYSTEM.md §4, §7). Use AFTER `requireAuth`.
 * Enforces that the authenticated user holds one of the allowed roles.
 * Authorization is always server-side; the UI is never the gate.
 */
export function requireRole(...allowed: UserRole[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw new UnauthorizedError('Authentication required.');
    if (!allowed.includes(req.auth.role)) {
      throw new ForbiddenError('You do not have permission to perform this action.');
    }
    next();
  };
}
