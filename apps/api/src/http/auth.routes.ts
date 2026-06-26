import { Router } from 'express';
import { GoogleLoginSchema, RefreshSchema } from '@campusly/shared-types';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { authService, type AuthContext } from '../services/authService.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { ValidationError } from '../domain/errors.js';
import type { Request } from 'express';

/**
 * Authentication endpoints (API_SPEC.md §3, AUTH_SYSTEM.md).
 * Mounted under /api/v1. Thin controllers: validate → delegate → respond.
 */
export const authRouter: Router = Router();

function context(req: Request): AuthContext {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

/** POST /auth/google — exchange a Google credential for a session. */
authRouter.post(
  '/auth/google',
  asyncHandler(async (req, res) => {
    const { credential } = GoogleLoginSchema.parse(req.body);
    const result = await authService.loginWithGoogle(credential, context(req));
    sendData(res, result, 201);
  }),
);

/** POST /auth/refresh — rotate the refresh token, issue a new access token. */
authRouter.post(
  '/auth/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = RefreshSchema.parse(req.body);
    if (!refreshToken) {
      throw new ValidationError('A refresh token is required.', [
        { field: 'refreshToken', issue: 'required' },
      ]);
    }
    const result = await authService.refresh(refreshToken, context(req));
    sendData(res, result);
  }),
);

/** POST /auth/logout — revoke the presented refresh token, end the session. */
authRouter.post(
  '/auth/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { refreshToken } = RefreshSchema.parse(req.body ?? {});
    await authService.logout(refreshToken, getAuth(req).sub);
    sendData(res, { success: true });
  }),
);

/** GET /auth/me — the current authenticated user. */
authRouter.get(
  '/auth/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await authService.getCurrentUser(getAuth(req).sub);
    sendData(res, { user });
  }),
);

/** DELETE /auth/account — initiate account deletion (grace window applies). */
authRouter.delete(
  '/auth/account',
  requireAuth,
  asyncHandler(async (req, res) => {
    await authService.deleteAccount(getAuth(req).sub);
    sendData(res, { success: true });
  }),
);
