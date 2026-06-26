import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import {
  ERROR_CODES,
  ERROR_HTTP_STATUS,
  type ApiError,
  type ErrorDetail,
} from '@campusly/shared-types';
import { AppError } from '../domain/errors.js';
import { logger } from '../config/logger.js';
import { isProduction } from '../config/env.js';

/** 404 handler for unmatched routes (mounted last, before the error handler). */
export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiError = {
    error: { code: ERROR_CODES.NOT_FOUND, message: 'The requested resource was not found.' },
  };
  res.status(ERROR_HTTP_STATUS[ERROR_CODES.NOT_FOUND]).json(body);
};

/**
 * Central error handler (CODING_STANDARDS.md §13.3, API_SPEC.md §17).
 * Maps known errors to the standard envelope; never leaks stack traces, SQL,
 * or secrets. Unknown errors collapse to a generic 500.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    const details: ErrorDetail[] = err.issues.map((issue) => ({
      field: issue.path.join('.') || undefined,
      issue: issue.message,
    }));
    const body: ApiError = {
      error: { code: ERROR_CODES.VALIDATION_ERROR, message: 'Request validation failed.', details },
    };
    res.status(ERROR_HTTP_STATUS[ERROR_CODES.VALIDATION_ERROR]).json(body);
    return;
  }

  if (err instanceof AppError) {
    const body: ApiError = {
      error: { code: err.code, message: err.message, details: err.details },
    };
    res.status(ERROR_HTTP_STATUS[err.code]).json(body);
    return;
  }

  // Unknown error — log internally, expose nothing.
  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  const body: ApiError = {
    error: {
      code: ERROR_CODES.SERVER_ERROR,
      message: isProduction
        ? 'Something went wrong. Please try again.'
        : err instanceof Error
          ? err.message
          : 'Unknown error',
    },
  };
  res.status(ERROR_HTTP_STATUS[ERROR_CODES.SERVER_ERROR]).json(body);
};
