import type { ErrorCode } from './errors';

/**
 * The standard API response envelope (API_SPEC.md §2.3).
 * Every REST response is exactly one of `ApiSuccess` or `ApiError`.
 */

/** Optional cursor-pagination metadata returned on list endpoints (API_SPEC.md §2.4). */
export interface PaginationMeta {
  cursor: string | null;
  hasMore: boolean;
}

/** A single actionable error detail (e.g. per-field validation issue). */
export interface ErrorDetail {
  field?: string;
  issue: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

/** Narrowing helper for clients consuming the envelope. */
export function isApiError<T>(res: ApiResponse<T>): res is ApiError {
  return (res as ApiError).error !== undefined;
}
