'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../components/AuthProvider';
import { GoogleSignInButton } from '../../components/GoogleSignInButton';
import { Card, CardTitle, CardDescription } from '../../components/ui/Card';
import { ApiClientError } from '../../lib/apiClient';

/**
 * Authentication screen (UI_GUIDELINES.md §12: single centered card, one-tap
 * Google sign-in dominant, calm and trustworthy). AUTH_SYSTEM.md §3.
 */
export default function SignInPage() {
  const { loginWithGoogle } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleCredential = useCallback(
    (credential: string) => {
      setError(null);
      setPending(true);
      loginWithGoogle(credential)
        .then((user) => {
          // Incomplete profiles finish onboarding; verified users go home (Phase 02).
          router.replace(user.profileComplete ? '/' : '/onboarding');
        })
        .catch((err: unknown) => {
          setError(
            err instanceof ApiClientError
              ? err.message
              : 'Something went wrong signing you in. Please try again.',
          );
        })
        .finally(() => setPending(false));
    },
    [loginWithGoogle, router],
  );

  return (
    <main className="flex min-h-screen items-center justify-center px-space-4">
      <Card className="flex w-full max-w-sm flex-col items-center gap-space-6 py-space-10 text-center">
        <div className="flex flex-col gap-space-2">
          <span className="text-h2 font-semibold text-brand">Campusly</span>
          <CardTitle>Welcome to your campus</CardTitle>
          <CardDescription>
            Sign in with your college Google account. Campusly is for verified students only.
          </CardDescription>
        </div>

        <GoogleSignInButton onCredential={handleCredential} />

        {pending && <p className="text-caption text-muted-foreground">Signing you in…</p>}
        {error && (
          <p className="text-caption text-danger" role="alert">
            {error}
          </p>
        )}

        <p className="text-small text-muted-foreground">
          By continuing you agree to be a respectful member of your campus community.
        </p>
      </Card>
    </main>
  );
}
