import { OAuth2Client } from 'google-auth-library';
import { config } from '../config/env.js';
import { AuthenticationError } from '../domain/errors.js';

/**
 * Verifies Google OAuth credentials server-side (AUTH_SYSTEM.md §3, SECURITY.md §3).
 * The client never asserts identity; we validate the credential against Google
 * and extract only the verified profile fields we need.
 */
const client = new OAuth2Client(config.GOOGLE_CLIENT_ID);

export interface VerifiedGoogleProfile {
  googleSub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  pictureUrl: string | null;
}

export const googleAuthService = {
  async verifyCredential(credential: string): Promise<VerifiedGoogleProfile> {
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: config.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch {
      throw new AuthenticationError('Could not verify your Google sign-in. Please try again.');
    }

    if (!payload?.sub || !payload.email) {
      throw new AuthenticationError('Google sign-in did not return a valid profile.');
    }

    return {
      googleSub: payload.sub,
      email: payload.email,
      emailVerified: payload.email_verified === true,
      name: payload.name ?? payload.email.split('@')[0] ?? 'Student',
      pictureUrl: payload.picture ?? null,
    };
  },
};
