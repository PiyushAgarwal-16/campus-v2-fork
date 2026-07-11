import { BLOCKED_LOGIN_STATUSES, type AuthResponse, type AuthUser } from '@campusly/shared-types';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { sha256, verifyPassword } from '../lib/crypto.js';
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
    username: user.username ?? null,
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

/** Masks the local part for logs so we never write full email PII. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

function assertCanAuthenticate(user: UserRow): void {
  if (BLOCKED_LOGIN_STATUSES.includes(user.accountStatus)) {
    throw new ForbiddenError('This account is not permitted to sign in.');
  }
}

/**
 * Bootstrap platform admins (hardcoded). Any account signing in with one of
 * these institutional emails is promoted to `admin` if it isn't already an
 * admin/super_admin. This seeds initial operators before the in-app role
 * management exists to grant the first admins.
 */
const BOOTSTRAP_ADMIN_EMAILS: ReadonlySet<string> = new Set([
  '2024cspiyush16750@poornima.edu.in',
  '2024csdevi18707@poornima.edu.in',
]);

/** Promotes a bootstrap-admin email to `admin` on sign-in (idempotent). */
async function ensureBootstrapAdmin(user: UserRow): Promise<UserRow> {
  if (user.role === 'admin' || user.role === 'super_admin') return user;
  if (!BOOTSTRAP_ADMIN_EMAILS.has(user.email.toLowerCase())) return user;
  await userRepository.updateRole(user.id, 'admin');
  logger.info({ userId: user.id }, 'Promoted bootstrap admin on sign-in');
  return { ...user, role: 'admin' };
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
      const domain = emailDomain(profile.email);
      let university = await universityRepository.findByEmailDomain(domain);
      if (!university && config.AUTH_ALLOW_ANY_DOMAIN) {
        // DEV-ONLY open sign-in: attach to the fallback campus.
        university = await universityRepository.getOrCreateOpenCampus();
      }
      // Diagnostic (no full-email PII): why a new account was accepted/rejected.
      logger.info(
        {
          email: maskEmail(profile.email),
          emailDomain: domain,
          hd: profile.hd,
          lookupInput: domain,
          matched: Boolean(university),
          matchedUniversityId: university?.id ?? null,
        },
        'Google sign-in campus eligibility check',
      );
      if (!university) {
        await loginHistoryRepository.record({
          event: 'login_failure',
          ipHash,
          userAgent: ctx.userAgent,
        });
        logger.warn(
          { emailDomain: domain, hd: profile.hd, reason: 'no_recognized_campus' },
          'Google sign-in rejected: email domain not mapped to a recognized campus',
        );
        throw new AuthenticationError(
          'Your email is not from a recognized campus. AnonymousU is for verified students only.',
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
    user = await ensureBootstrapAdmin(user);
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

  /**
   * Email + password sign-in. The user must have set credentials during
   * onboarding; legacy Google-only users cannot use this path.
   */
  async loginWithEmail(email: string, password: string, ctx: AuthContext): Promise<AuthResponse> {
    const ipHash = ctx.ip ? sha256(ctx.ip) : null;
    let user = await userRepository.findByEmail(email.toLowerCase());

    if (!user || !user.passwordHash) {
      await loginHistoryRepository.record({
        event: 'login_failure',
        ipHash,
        userAgent: ctx.userAgent,
      });
      throw new AuthenticationError('Invalid email or password.');
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      await loginHistoryRepository.record({
        userId: user.id,
        event: 'login_failure',
        ipHash,
        userAgent: ctx.userAgent,
      });
      throw new AuthenticationError('Invalid email or password.');
    }

    assertCanAuthenticate(user);
    user = await ensureBootstrapAdmin(user);
    await loginHistoryRepository.record({
      userId: user.id,
      event: 'login_success',
      ipHash,
      userAgent: ctx.userAgent,
    });
    return issueSession(user);
  },

  /** Check if a username is available (for real-time feedback during onboarding). */
  async checkUsernameAvailability(username: string): Promise<{ available: boolean }> {
    const existing = await userRepository.findByUsername(username.toLowerCase());
    return { available: !existing };
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
