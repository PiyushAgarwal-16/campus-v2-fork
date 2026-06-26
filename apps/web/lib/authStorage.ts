import type { AuthTokens } from '@campusly/shared-types';

/**
 * Client-side token storage (AUTH_SYSTEM.md §5).
 *
 * The access token is held in memory; the refresh token is persisted so the
 * session survives reloads. NOTE: moving the refresh token to an httpOnly,
 * SameSite cookie (with CSRF protection on the refresh endpoint) is the
 * hardening tracked in REVIEW_REPORT L-2 — a future improvement.
 */
const REFRESH_KEY = 'campusly.refreshToken';

let accessToken: string | null = null;
let expiresAtMs: number | null = null;

export const authStorage = {
  setTokens(tokens: AuthTokens): void {
    accessToken = tokens.accessToken;
    expiresAtMs = Date.now() + tokens.expiresIn * 1000;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    }
  },

  getAccessToken(): string | null {
    return accessToken;
  },

  /** True when the access token is missing or within 30s of expiry. */
  isAccessTokenExpired(): boolean {
    if (!accessToken || !expiresAtMs) return true;
    return Date.now() >= expiresAtMs - 30_000;
  },

  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(REFRESH_KEY);
  },

  clear(): void {
    accessToken = null;
    expiresAtMs = null;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(REFRESH_KEY);
    }
  },
};
