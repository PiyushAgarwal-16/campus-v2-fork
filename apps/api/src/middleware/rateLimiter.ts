import rateLimit from 'express-rate-limit';
import { ERROR_CODES, ERROR_HTTP_STATUS, type ApiError } from '@campusly/shared-types';

/**
 * Rate-limiting seam (SECURITY.md §10, Phase 00). Minimal global rules now;
 * per-endpoint limiters (auth, matching, messaging) are layered in later phases.
 * Note: in-memory store is single-instance only — a shared store (Redis) is a
 * future addition when the API runs multi-instance (REVIEW_REPORT.md).
 */
const tooManyRequestsBody: ApiError = {
  error: {
    code: ERROR_CODES.TOO_MANY_REQUESTS,
    message: 'Too many requests. Please slow down and try again shortly.',
  },
};

export const globalRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  statusCode: ERROR_HTTP_STATUS[ERROR_CODES.TOO_MANY_REQUESTS],
  message: tooManyRequestsBody,
});
