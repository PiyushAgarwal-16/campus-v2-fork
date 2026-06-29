'use client';

import { useCallback, useEffect, useState } from 'react';
import { Building2, Eye, MessageCircle, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../components/AuthProvider';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { ConstellationBackground } from '../components/landing/ConstellationBackground';
import { ApiClientError } from '../lib/apiClient';
import { cn } from '../lib/utils';

/**
 * Public landing / welcome page — the first impression for a visitor. Premium
 * dark hero with an animated "constellation" backdrop (students connecting),
 * the Campusly wordmark in the display face, and a single clear call to action.
 * Signed-in users are sent straight into the app.
 */
export default function LandingPage() {
  const { user, isLoading, loginWithGoogle } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const journeySteps = [
    { label: 'Anonymous chat', Icon: MessageCircle },
    { label: 'Reveal', Icon: Eye },
    { label: 'Friends', Icon: Users },
    { label: 'Campus wall', Icon: Building2 },
  ];

  useEffect(() => {
    if (!isLoading && user) router.replace('/match');
  }, [user, isLoading, router]);

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentView = new URLSearchParams(window.location.search).get('view');
    if (currentView === 'signin') {
      setShowSignIn(true);
    }
  }, []);

  const setViewInUrl = useCallback(
    (view: 'signin' | null, mode: 'push' | 'replace' = 'replace') => {
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      if (view) {
        url.searchParams.set('view', view);
      } else {
        url.searchParams.delete('view');
      }
      const nextUrl = `${url.pathname}${url.search}${url.hash}`;
      if (mode === 'push') {
        window.history.pushState({}, '', nextUrl);
        return;
      }
      window.history.replaceState({}, '', nextUrl);
    },
    [],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncViewFromUrl = () => {
      const currentView = new URLSearchParams(window.location.search).get('view');
      setShowSignIn(currentView === 'signin');
      if (currentView !== 'signin') {
        setError(null);
      }
    };

    window.addEventListener('popstate', syncViewFromUrl);
    return () => window.removeEventListener('popstate', syncViewFromUrl);
  }, []);

  const openSignIn = useCallback(() => {
    if (showSignIn) return;
    setShowSignIn(true);
    setViewInUrl('signin', 'push');
  }, [setViewInUrl, showSignIn]);

  const closeSignIn = useCallback(() => {
    setShowSignIn(false);
    setError(null);
    setViewInUrl(null, 'push');
  }, [setViewInUrl]);

  const handleCredential = useCallback(
    (credential: string) => {
      setError(null);
      setPending(true);
      loginWithGoogle(credential)
        .then((signedInUser) => {
          router.replace(signedInUser.profileComplete ? '/match' : '/onboarding');
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

  // While auth resolves (or a signed-in user is being redirected), render the
  // dark canvas only — avoids a flash of marketing content for logged-in users.
  const showContent = !isLoading && !user;

  return (
    <div className="dark relative min-h-screen overflow-hidden bg-background text-foreground">
      <ConstellationBackground />

      {/* Calm overlay keeps the hero text legible over the animation. */}
      <div className="pointer-events-none absolute inset-0 bg-background/40" aria-hidden />

      {showContent && (
        <div
          className={cn(
            'relative z-10 flex min-h-screen flex-col transition-all duration-700',
            mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
          )}
        >
          {/* Top bar */}
          <header className="flex items-center justify-between px-space-5 py-space-5 md:px-space-12">
            <span className="font-display text-h3 font-bold tracking-tight">
              Campus<span className="text-brand">ly</span>
            </span>
            <button
              type="button"
              onClick={openSignIn}
              className="text-caption text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </button>
          </header>

          {/* Hero */}
          <main className="flex flex-1 flex-col items-center justify-center px-space-5 text-center">
            <div className="mb-space-7 flex justify-center" aria-label="Campusly logo mark">
              <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-border/40 bg-surface/20 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.04)]">
                <svg
                  className="h-16 w-16"
                  viewBox="0 0 100 100"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <linearGradient id="cGrad1" x1="0" y1="0" x2="100" y2="100">
                      <stop offset="0%" stopColor="#FF9900" />
                      <stop offset="100%" stopColor="#EA580C" />
                    </linearGradient>
                    <linearGradient id="cGrad2" x1="100" y1="0" x2="0" y2="100">
                      <stop offset="0%" stopColor="#FB923C" />
                      <stop offset="100%" stopColor="#FF9900" />
                    </linearGradient>
                    <filter id="logoGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="2.5" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                  </defs>

                  {/* Outer orbital track */}
                  <circle
                    cx="50"
                    cy="50"
                    r="42"
                    stroke="currentColor"
                    strokeWidth="0.8"
                    strokeDasharray="4 4"
                    className="text-border/40 animate-[spin_80s_linear_infinite]"
                  />

                  {/* Overlapping Loop 1 (Back arc) */}
                  <path
                    d="M75,32 A 28,28 0 1, 0 75,68"
                    stroke="url(#cGrad1)"
                    strokeWidth="9"
                    strokeLinecap="round"
                  />

                  {/* Overlapping Loop 2 (Front offset arc creating depth) */}
                  <path
                    d="M75,32 C 60,18 36,22 29,38 C 21,54 25,72 43,78"
                    stroke="url(#cGrad2)"
                    strokeWidth="9"
                    strokeLinecap="round"
                  />

                  {/* Connecting spark */}
                  <circle
                    cx="75"
                    cy="32"
                    r="4.5"
                    fill="#FFFFFF"
                    filter="url(#logoGlow)"
                    className="animate-pulse"
                  />
                  <circle cx="75" cy="32" r="2" fill="#FF9900" />
                </svg>
              </div>
            </div>

            <h1 className="font-display text-display tracking-tight">
              Campus<span className="text-brand">ly</span>
            </h1>

            <div className="mt-space-8 w-full max-w-3xl overflow-hidden">
              <div
                className={cn(
                  'grid w-[200%] grid-cols-2 transition-transform duration-700 ease-out',
                  showSignIn ? '-translate-x-1/2' : 'translate-x-0',
                )}
              >
                <section className="px-space-2">
                  <div className="flex flex-col items-center gap-space-3 sm:justify-center">
                    <button
                      type="button"
                      onClick={openSignIn}
                      className="inline-flex h-12 items-center justify-center rounded-button bg-brand px-space-8 text-body font-semibold text-brand-foreground transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    >
                      Enter Campusly
                    </button>
                  </div>

                  <div className="mt-space-8 w-full">
                    <div className="relative mx-auto w-full max-w-3xl">
                      <svg
                        className="pointer-events-none absolute left-[8%] right-[8%] top-5 hidden h-6 w-[84%] md:block"
                        viewBox="0 0 100 24"
                        preserveAspectRatio="none"
                        aria-hidden
                      >
                        <path
                          d="M 0 12 C 15 2, 35 22, 50 12 C 65 2, 85 22, 100 12"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeDasharray="4 4"
                          className="text-muted-foreground/50"
                        />
                      </svg>

                      <div className="grid grid-cols-2 gap-space-4 md:grid-cols-4">
                        {journeySteps.map(({ label, Icon }, index) => (
                          <div
                            key={label}
                            className={cn(
                              'flex flex-col items-center gap-space-2 px-space-2 text-center transition-all duration-500',
                              mounted && !showSignIn
                                ? 'translate-y-0 opacity-100'
                                : 'translate-y-2 opacity-0',
                            )}
                            style={{ transitionDelay: `${160 + index * 120}ms` }}
                          >
                            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/70 text-brand">
                              <Icon className="h-4 w-4" strokeWidth={2.2} />
                            </span>
                            <p className="text-small text-foreground/95">{label}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="px-space-2">
                  <div className="mx-auto flex w-full max-w-md flex-col items-center gap-space-4 px-space-5 py-space-6 text-left">
                    <div className="w-full text-center">
                      <h2 className="text-h2 text-foreground">Sign in to your campus</h2>
                      <p className="mt-space-2 text-caption text-muted-foreground">
                        Use your college Google account. Campusly is for verified students only.
                      </p>
                    </div>

                    <div className="w-full">
                      <GoogleSignInButton onCredential={handleCredential} />
                    </div>

                    {pending && (
                      <p className="text-caption text-muted-foreground">Signing you in...</p>
                    )}
                    {error && (
                      <p className="text-caption text-danger" role="alert">
                        {error}
                      </p>
                    )}

                    <button
                      type="button"
                      onClick={closeSignIn}
                      className="text-small text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Back to welcome
                    </button>
                  </div>
                </section>
              </div>
            </div>
          </main>

          <footer className="px-space-5 py-space-6 text-center text-small text-muted-foreground">
            Built for campuses. Private by design. Accountable by verification.
          </footer>
        </div>
      )}
    </div>
  );
}
