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
                  className="h-20 w-20 animate-[spin_45s_linear_infinite]"
                  viewBox="0 0 100 100"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <defs>
                    <radialGradient id="logoGlow" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#F97316" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#F97316" />
                      <stop offset="100%" stopColor="#FB923C" />
                    </linearGradient>
                  </defs>
                  {/* Glow aura */}
                  <circle cx="50" cy="50" r="40" fill="url(#logoGlow)" />

                  {/* Outer orbit (forming shape of C) */}
                  <path
                    d="M72,22 A32,32 0 1,0 72,78"
                    stroke="currentColor"
                    strokeWidth="0.8"
                    strokeLinecap="round"
                    className="text-border/60"
                  />

                  {/* Constellation lattice lines */}
                  <g stroke="#F97316" strokeWidth="0.8" strokeOpacity="0.3" strokeDasharray="1 1">
                    <line x1="72" y1="22" x2="50" y2="16" />
                    <line x1="50" y1="16" x2="28" y2="30" />
                    <line x1="28" y1="30" x2="20" y2="50" />
                    <line x1="20" y1="50" x2="28" y2="70" />
                    <line x1="28" y1="70" x2="50" y2="84" />
                    <line x1="50" y1="84" x2="72" y2="78" />
                    {/* Cross lattices */}
                    <line x1="72" y1="22" x2="28" y2="30" />
                    <line x1="50" y1="16" x2="20" y2="50" />
                    <line x1="28" y1="30" x2="28" y2="70" />
                    <line x1="20" y1="50" x2="50" y2="84" />
                    <line x1="28" y1="70" x2="72" y2="78" />
                  </g>

                  {/* Nodes */}
                  <g>
                    {/* Node 1 */}
                    <circle cx="72" cy="22" r="3" fill="#F97316" className="animate-pulse" />
                    <circle
                      cx="72"
                      cy="22"
                      r="6"
                      stroke="#F97316"
                      strokeWidth="0.5"
                      strokeOpacity="0.4"
                      className="animate-ping"
                      style={{ animationDuration: '3.5s' }}
                    />

                    {/* Node 2 */}
                    <circle cx="50" cy="16" r="2.5" fill="#E4E4E7" />

                    {/* Node 3 */}
                    <circle cx="28" cy="30" r="3.5" fill="url(#logoGrad)" />

                    {/* Node 4 */}
                    <circle cx="20" cy="50" r="3.2" fill="#E4E4E7" />
                    <circle
                      cx="20"
                      cy="50"
                      r="7"
                      stroke="#E4E4E7"
                      strokeWidth="0.5"
                      strokeOpacity="0.3"
                      className="animate-ping"
                      style={{ animationDuration: '4.5s' }}
                    />

                    {/* Node 5 */}
                    <circle cx="28" cy="70" r="3.5" fill="url(#logoGrad)" />

                    {/* Node 6 */}
                    <circle cx="50" cy="84" r="2.5" fill="#E4E4E7" />

                    {/* Node 7 */}
                    <circle cx="72" cy="78" r="3" fill="#F97316" className="animate-pulse" />
                    <circle
                      cx="72"
                      cy="78"
                      r="6"
                      stroke="#F97316"
                      strokeWidth="0.5"
                      strokeOpacity="0.4"
                      className="animate-ping"
                      style={{ animationDuration: '2.8s' }}
                    />
                  </g>
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
