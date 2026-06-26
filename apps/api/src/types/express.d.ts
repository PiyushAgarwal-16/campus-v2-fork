import type { AccessTokenClaims } from '@campusly/shared-types';

/**
 * Express request augmentation: `req.auth` carries the verified JWT claims
 * once `requireAuth` has run. Populated server-side only — never from the client.
 */
declare global {
  namespace Express {
    interface Request {
      auth?: AccessTokenClaims;
    }
  }
}

export {};
