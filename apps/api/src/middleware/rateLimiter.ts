import rateLimit, { type RateLimitRequestHandler } from 'express-rate-limit';
import { ERROR_CODES, ERROR_HTTP_STATUS, type ApiError } from '@campusly/shared-types';

/**
 * Rate limiting (SECURITY.md §10, §16). A coarse global limiter plus tighter
 * per-endpoint limiters on sensitive/abuse-prone actions (auth, media uploads,
 * content writes, friend requests, reports). Authenticated limiters key by user
 * id (fair per-account limits); unauthenticated ones key by IP.
 *
 * Note: the in-memory store is single-instance only — a shared store (Redis)
 * is required once the API runs multi-instance (REVIEW_REPORT.md, INFRASTRUCTURE.md §14).
 */
const tooManyRequestsBody: ApiError = {
  error: {
    code: ERROR_CODES.TOO_MANY_REQUESTS,
    message: 'Too many requests. Please slow down and try again shortly.',
  },
};

const STATUS = ERROR_HTTP_STATUS[ERROR_CODES.TOO_MANY_REQUESTS];

/** Factory for a limiter with shared envelope/headers. */
function makeLimiter(options: {
  windowMs: number;
  limit: number;
  /** When true, key by authenticated user id (falls back to IP). Use AFTER requireAuth. */
  perUser?: boolean;
}): RateLimitRequestHandler {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    statusCode: STATUS,
    message: tooManyRequestsBody,
    // Per-user limiters key on the verified subject (a UUID) so one abusive
    // account can't exhaust a shared NAT IP's budget for everyone behind it.
    ...(options.perUser
      ? {
          keyGenerator: (req: { auth?: { sub?: string }; ip?: string }) =>
            req.auth?.sub ?? req.ip ?? 'anon',
        }
      : {}),
  });
}

/** Coarse safety net across the whole API. */
export const globalRateLimiter = makeLimiter({ windowMs: 60_000, limit: 300 });

/** Auth endpoints (login, refresh, username checks) — strict, keyed by IP. */
export const authRateLimiter = makeLimiter({ windowMs: 60_000, limit: 15 });

/** Media upload-URL requests — bounded per user (uploads are expensive). */
export const uploadRateLimiter = makeLimiter({ windowMs: 60_000, limit: 30, perUser: true });

/** Content writes (posts, replies, community posts) — per user. */
export const writeRateLimiter = makeLimiter({ windowMs: 60_000, limit: 40, perUser: true });

/** Friend requests — per user (spam resistance, FRIEND_SYSTEM.md §3). */
export const friendRequestRateLimiter = makeLimiter({ windowMs: 60_000, limit: 20, perUser: true });

/** Report submissions — per user (prevents report flooding). */
export const reportRateLimiter = makeLimiter({ windowMs: 60_000, limit: 15, perUser: true });

/**
 * Admin-surface requests — per operator (keyed by verified subject; use AFTER
 * requireAuth). A higher bound than write/report limiters since privileged
 * consoles are chatty (dashboards, lists, drilldowns), but still bounded so a
 * single compromised/abusive admin session can't hammer the API. Returns the
 * same 429 envelope as the other limiters (ADMIN_PANEL.md §13, SECURITY.md §16).
 */
export const adminRateLimiter = makeLimiter({ windowMs: 60_000, limit: 120, perUser: true });
