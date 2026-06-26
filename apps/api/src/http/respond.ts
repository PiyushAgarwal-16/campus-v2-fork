import type { Response } from 'express';
import type { ApiSuccess, PaginationMeta } from '@campusly/shared-types';

/**
 * Helpers that enforce the standard success envelope (API_SPEC.md §2.3).
 * Errors are produced centrally by the error handler, never here.
 */
export function sendData<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccess<T> = { data };
  res.status(status).json(body);
}

export function sendPaginated<T>(res: Response, data: T, meta: PaginationMeta, status = 200): void {
  const body: ApiSuccess<T> = { data, meta };
  res.status(status).json(body);
}
