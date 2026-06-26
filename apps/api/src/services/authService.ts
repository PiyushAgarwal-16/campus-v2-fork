import { BLOCKED_LOGIN_STATUSES, type AuthResponse, type AuthUser } from '@campusly/shared-types';
import { config } from '../config/env.js';
import { sha256 } from '../lib/crypto.js';
import { AuthenticationError, ForbiddenError, NotFoundError } from '../domain/errors.js';
import type { UserRow } from '../db/schema.js';
import { userRepository } from '../repositories/userRepository.js';
import { universityRepository } from '../repositories/universityRepository.js';
import { refreshTokenRepository } from '../repositories/refreshTokenRepository.js';
import { loginHistoryRepository } from '../repositories/loginHistoryRepository.js';
import { tokenService } from './tokenService.js';
import { googleAuthService } from './googleAuthService.js';

/** Request context for audit logging (hashed IP + user agent). */
export interface AuthContext {
  ip?: string;
  userAgent?: string;
}

/** Maps a user row to the client-safe AuthUser DTO. */
export function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    universityId: user.universityId,
    role: user.role,
    accountStatus: user.accountStatus,
    subscriptionStatus: user.subscriptionStatus,
    profileComplete: user.accountStatus === 'active',
  };
}

function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

function assertCanAuthenticate(user: UserRow): void {
  if (BLOCKED_LOGIN_STATUSES.includes(user.accountStatus)) {
    throw new ForbiddenError('This account is not permitted to sign in.');
  }
}

async function issueSession(user: UserRow): Promise<AuthResponse> {
  const accessToken = tokenService.signAccessToken({
    sub: user.id,
    role: user.role,
    status: user.accountStatus,
    universityId: user.universityId,
  });
  const refreshToken = await tokenService.issueRefreshToken(user.id);
  return {
    user: toAuthUser(user),
    tokens: { accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS },
  };
}

export const authService = {
  /**
   * Google sign-in (AUTH_SYSTEM.md §3): verify credential → validate
   * institutional domain → find-or-create verified user → reject blocked
   * accounts → issue tokens. New users start `pending_verification` and become
   * `active` after profile completion (Phase 02).
   */
  async loginWithGoogle(credential: string, ctx: AuthContext): Promise<AuthResponse> {
    const profile = await googleAuthService.verifyCredential(credential);
    const ipHash = ctx.ip ? sha256(ctx.ip) : null;

    // Returning user?
    let user = await userRepository.findByGoogleSub(profile.googleSub);

    if (!user) {
      // New user — enforce institutional-domain eligibility (AUTH_SYSTEM.md §3).
      const university = await universityRepository.findByEmailDomain(emailDomain(profile.email));
      if (!university) {
        await loginHistoryRepository.record({
          event: 'login_failure',
          ipHash,
          userAgent: ctx.userAgent,
        });
        throw new AuthenticationError(
          'Your email is not from a recognized campus. Campusly is for verified students only.',
        );
      }
      user = await userRepository.createWithGoogle({
        user: {
          universityId: university.id,
          email: profile.email,
          name: profile.name,
          accountStatus: 'pending_verification',
        },
        google: {
          googleSub: profile.googleSub,
          email: profile.email,
          pictureUrl: profile.pictureUrl,
        },
      });
    }

    assertCanAuthenticate(user);
    await loginHistoryRepository.record({
      userId: user.id,
      event: 'login_success',
      ipHash,
      userAgent: ctx.userAgent,
    });
    return issueSession(user);
  },

  /**
   * Refresh-token rotation (AUTH_SYSTEM.md §5/§4.7). Re-checks account status so
   * a banned/suspended user cannot refresh into continued access.
   */
  async refresh(rawToken: string, ctx: AuthContext): Promise<AuthResponse> {
    const { userId, refreshToken } = await tokenService.rotateRefreshToken(rawToken);
    const user = await userRepository.findById(userId);
    if (!user) throw new AuthenticationError('Account no longer exists.');
    assertCanAuthenticate(user);

    const accessToken = tokenService.signAccessToken({
      sub: user.id,
      role: user.role,
      status: user.accountStatus,
      universityId: user.universityId,
    });
    await loginHistoryRepository.record({
      userId: user.id,
      event: 'refresh',
      ipHash: ctx.ip ? sha256(ctx.ip) : null,
      userAgent: ctx.userAgent,
    });
    return {
      user: toAuthUser(user),
      tokens: { accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS },
    };
  },

  /** Logout (AUTH_SYSTEM.md §4.6): revoke the presented refresh token. */
  async logout(rawToken: string | undefined, userId: string | undefined): Promise<void> {
    if (rawToken) await tokenService.revokeRefreshToken(rawToken);
    if (userId) await loginHistoryRepository.record({ userId, event: 'logout' });
  },

  /** Current authenticated user (GET /auth/me). */
  async getCurrentUser(userId: string): Promise<AuthUser> {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('Account not found.');
    return toAuthUser(user);
  },

  /**
   * Account deletion (AUTH_SYSTEM.md §8): soft-delete now, revoke all sessions;
   * PII is hard-purged after the grace window by a background job (Phase 12+).
   */
  async deleteAccount(userId: string): Promise<void> {
    await userRepository.softDelete(userId);
    await refreshTokenRepository.revokeAllForUser(userId);
  },
};
