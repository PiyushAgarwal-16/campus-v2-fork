import { isApiError, type ApiResponse, type AuthResponse } from '@campusly/shared-types';
import { apiUrl } from './env';
import { authStorage } from './authStorage';

/**
 * Thin fetch wrapper that understands the standard API envelope (API_SPEC.md §2.3).
 * Returns `data` on success and throws `ApiClientError` on the error envelope.
 *
 * Phase 01: injects the Bearer access token and transparently refreshes once on
 * a 401/unauthorized (AUTH_SYSTEM.md §4.7), then retries the original request.
 */
export class ApiClientError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
  }
}

interface FetchOptions extends RequestInit {
  /** Set true for endpoints that must not attach a token or attempt refresh. */
  skipAuth?: boolean;
}

async function rawFetch<T>(path: string, init: FetchOptions, token: string | null): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  const body = (await res.json()) as ApiResponse<T>;
  if (isApiError(body)) {
    throw new ApiClientError(body.error.code, body.error.message);
  }
  return body.data;
}

/** Attempts a one-time refresh-token rotation. Returns true on success. */
async function tryRefresh(): Promise<boolean> {
  const refreshToken = authStorage.getRefreshToken();
  if (!refreshToken) return false;
  try {
    const data = await rawFetch<AuthResponse>(
      '/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refreshToken }) },
      null,
    );
    authStorage.setTokens(data.tokens);
    return true;
  } catch {
    authStorage.clear();
    return false;
  }
}

export async function apiFetch<T>(path: string, init: FetchOptions = {}): Promise<T> {
  const { skipAuth, ...rest } = init;

  if (skipAuth) {
    return rawFetch<T>(path, rest, null);
  }

  // Proactively refresh an expired access token before the request.
  if (authStorage.isAccessTokenExpired() && authStorage.getRefreshToken()) {
    await tryRefresh();
  }

  try {
    return await rawFetch<T>(path, rest, authStorage.getAccessToken());
  } catch (err) {
    // Reactive refresh on a 401, then retry once.
    if (
      err instanceof ApiClientError &&
      (err.code === 'unauthorized' || err.code === 'authentication_failed')
    ) {
      if (await tryRefresh()) {
        return rawFetch<T>(path, rest, authStorage.getAccessToken());
      }
    }
    throw err;
  }
}
