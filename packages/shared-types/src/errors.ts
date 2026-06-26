/**
 * Canonical API error codes (API_SPEC.md §17).
 * Used identically by the API (error handler) and the web client.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'validation_error',
  AUTHENTICATION_FAILED: 'authentication_failed',
  UNAUTHORIZED: 'unauthorized',
  FORBIDDEN: 'forbidden',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  TOO_MANY_REQUESTS: 'too_many_requests',
  SERVER_ERROR: 'server_error',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Maps each error code to its canonical HTTP status (API_SPEC.md §17). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  [ERROR_CODES.VALIDATION_ERROR]: 400,
  [ERROR_CODES.AUTHENTICATION_FAILED]: 401,
  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.FORBIDDEN]: 403,
  [ERROR_CODES.NOT_FOUND]: 404,
  [ERROR_CODES.CONFLICT]: 409,
  [ERROR_CODES.TOO_MANY_REQUESTS]: 429,
  [ERROR_CODES.SERVER_ERROR]: 500,
};
