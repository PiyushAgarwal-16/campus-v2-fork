import { createHmac } from 'node:crypto';
import type { RequestHandler } from 'express';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { moderationRepository } from '../repositories/moderationRepository.js';

/**
 * Admin access logger (ADMIN_PANEL.md §13, SECURITY.md §9, Requirements 14.1/14.3/14.4).
 *
 * Writes exactly one `admin.access` audit entry per admin request for
 * accountability, WITHOUT ever persisting the raw client address. The address
 * is reduced to a one-way, keyed digest (HMAC-SHA256) so audits can correlate
 * activity from the same source over time while remaining non-reversible and
 * PII-minimal (Req 14.3, 14.4).
 *
 * Fire-and-forget: the audit write never blocks or fails the request — a write
 * error is logged and swallowed, mirroring `notificationService`'s pattern so
 * accountability logging can never take down the privileged surface it guards.
 * Use AFTER `requireAuth` so `req.auth.sub` identifies the operator.
 */

/**
 * One-way HMAC-SHA256 of the client address, keyed with an existing server
 * secret so the digest can't be brute-forced from the (small) IP space by an
 * attacker who only sees the audit rows. The raw IP is never returned or logged.
 */
function hashClientAddress(ip: string): string {
  return createHmac('sha256', config.JWT_ACCESS_SECRET).update(ip).digest('hex');
}

export const adminAccessLogger: RequestHandler = (req, _res, next) => {
  const actorId = req.auth?.sub ?? null;
  const ip = req.ip;

  // Fire-and-forget: never await, never block the request on the audit write.
  void moderationRepository
    .writeAudit({
      actorId,
      action: 'admin.access',
      metadata: {
        method: req.method,
        path: req.path,
        // One-way hash only — the raw IP is intentionally never stored/logged.
        addressHash: ip ? hashClientAddress(ip) : null,
      },
    })
    .catch((err: unknown) => {
      logger.error({ err, actorId }, 'admin access audit write failed');
    });

  next();
};
