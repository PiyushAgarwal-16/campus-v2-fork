import { z } from 'zod';

/**
 * Authentication & identity contracts (AUTH_SYSTEM.md, DATABASE_SCHEMA.md §5).
 * Single source of truth shared by api and web.
 */

/** Canonical user roles (DATABASE_SCHEMA.md §5.3, AUTH_SYSTEM.md §7). */
export const USER_ROLES = [
  'student',
  'community_moderator',
  'club_admin',
  'moderator',
  'admin',
  'super_admin',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Canonical account states (DATABASE_SCHEMA.md §5.3, AUTH_SYSTEM.md §11). */
export const ACCOUNT_STATUSES = [
  'pending_verification',
  'active',
  'restricted',
  'suspended',
  'banned',
  'deactivated',
] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Subscription tier cache on the user record (DATABASE_SCHEMA.md §5.3). */
export const SUBSCRIPTION_STATUSES = ['free', 'premium'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Account states from which a user may NOT authenticate (AUTH_SYSTEM.md §11). */
export const BLOCKED_LOGIN_STATUSES: readonly AccountStatus[] = ['banned', 'suspended'];

/**
 * The authenticated user as exposed to clients and carried in JWT claims.
 * Never includes tokens, hashes, or other users' private data.
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  universityId: string;
  role: UserRole;
  accountStatus: AccountStatus;
  subscriptionStatus: SubscriptionStatus;
  /** True once the account has completed verification + profile (status === 'active'). */
  profileComplete: boolean;
}

/** JWT access-token claims (AUTH_SYSTEM.md §4.3). */
export interface AccessTokenClaims {
  sub: string; // user id
  role: UserRole;
  status: AccountStatus;
  universityId: string;
}

/** POST /auth/google — exchange a Google credential for a session. */
export const GoogleLoginSchema = z.object({
  credential: z.string().min(1, 'Google credential is required.'),
});
export type GoogleLoginInput = z.infer<typeof GoogleLoginSchema>;

/** POST /auth/refresh — refresh-token rotation (token may also come from cookie). */
export const RefreshSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type RefreshInput = z.infer<typeof RefreshSchema>;

/** Successful auth response (tokens + the authenticated user). */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access-token lifetime in seconds
}

export interface AuthResponse {
  user: AuthUser;
  tokens: AuthTokens;
}
