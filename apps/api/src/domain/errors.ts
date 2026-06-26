import { ERROR_CODES, type ErrorCode, type ErrorDetail } from '@campusly/shared-types';

/**
 * Typed, centralized application error (CODING_STANDARDS.md §13.3).
 * Services and middleware throw `AppError` (or a subclass); the central error
 * handler maps it to the standard envelope. Strings are never thrown directly.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];

  constructor(code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Request validation failed.', details?: ErrorDetail[]) {
    super(ERROR_CODES.VALIDATION_ERROR, message, details);
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed.') {
    super(ERROR_CODES.AUTHENTICATION_FAILED, message);
    this.name = 'AuthenticationError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Your session is no longer valid.') {
    super(ERROR_CODES.UNAUTHORIZED, message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super(ERROR_CODES.FORBIDDEN, message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super(ERROR_CODES.NOT_FOUND, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'That conflicts with the current state.') {
    super(ERROR_CODES.CONFLICT, message);
    this.name = 'ConflictError';
  }
}
