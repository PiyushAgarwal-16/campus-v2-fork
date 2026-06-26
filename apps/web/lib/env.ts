/**
 * Public client configuration. Only NEXT_PUBLIC_* values are exposed to the
 * browser; no secrets ever live here (SECURITY.md §10).
 */
export const clientEnv = {
  apiBaseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000',
  apiPrefix: '/api/v1',
  googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '',
} as const;

export const apiUrl = (path: string): string =>
  `${clientEnv.apiBaseUrl}${clientEnv.apiPrefix}${path.startsWith('/') ? path : `/${path}`}`;
