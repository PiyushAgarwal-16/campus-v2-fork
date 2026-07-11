import type { RequestHandler } from 'express';
import { getAuth } from './requireAuth.js';
import { ForbiddenError } from '../domain/errors.js';

/**
 * Active-account guard for admin surfaces (Admin Control Center Req 3.1).
 * Use AFTER `requireAuth`. Denies any request whose verified token claims carry
 * an account status other than `active` (e.g. suspended, banned, deactivated,
 * pending_verification). The decision is made solely from `req.auth` — never
 * from client-supplied body/query/headers. Fails closed.
 */
export const requireActiveAccount: RequestHandler = (req, _res, next) => {
  const auth = getAuth(req);
  if (auth.status !== 'active') {
    throw new ForbiddenError('Active account required.');
  }
  next();
};
