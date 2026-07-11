import type { RequestHandler, Request } from 'express';
import { ForbiddenError } from '../domain/errors.js';
import { moderationRepository } from '../repositories/moderationRepository.js';

/**
 * Admin access auditing (ADMIN_PANEL.md §12, Requirement 3.6).
 *
 * When the Authorization_Guard rejects a privileged request because the caller's
 * role does not satisfy the route tier, accountability requires that the denial
 * itself is recorded — independent of whether the handler ever runs. This module
 * provides that record and a reusable wrapper that fires it on rejection.
 *
 * Reuses the existing audit-write mechanism (`moderationRepository.writeAudit`);
 * it never opens a second audit insert path.
 */

/**
 * Writes exactly one `access.permission_denied` `audit_logs` entry for the
 * current request. Records the acting operator (`req.auth?.sub`, which may be
 * `null` if an unauthenticated request somehow reached the guard) and captures
 * the attempted route/resource as the target plus request metadata.
 */
export async function auditPermissionDenied(req: Request): Promise<void> {
  await moderationRepository.writeAudit({
    actorId: req.auth?.sub ?? null,
    action: 'access.permission_denied',
    targetType: 'admin_route',
    targetId: req.path,
    metadata: { method: req.method, path: req.originalUrl },
  });
}

/**
 * Wraps a role/tier guard so that an insufficient-role rejection triggers
 * {@link auditPermissionDenied} exactly once *before* the `403` is returned,
 * then propagates the original `ForbiddenError` unchanged. Non-authorization
 * errors pass through untouched and are never audited here.
 *
 * Handles both rejection styles: a guard that throws synchronously (as the
 * existing `requireRole` does) and one that reports via `next(err)`. On success
 * the request proceeds normally with no audit write.
 *
 * Route files wrap their tier guard with this — e.g.
 * `withDenialAudit(requireRole(...ADMIN_ROLES))` — to keep it generic and reusable.
 */
export function withDenialAudit(guard: RequestHandler): RequestHandler {
  return (req, res, next) => {
    // Fires the denial audit once, then forwards the same error either way so a
    // failed audit write never suppresses the 403.
    const handleError = (err: unknown): void => {
      if (!(err instanceof ForbiddenError)) {
        next(err);
        return;
      }
      void auditPermissionDenied(req).then(
        () => next(err),
        () => next(err),
      );
    };

    try {
      guard(req, res, (err?: unknown) => {
        if (err) {
          handleError(err);
        } else {
          next();
        }
      });
    } catch (err) {
      handleError(err);
    }
  };
}
