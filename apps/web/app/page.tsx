'use client';
import Image from 'next/image';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Building2,
  Eye,
  MessageCircle,
  Users,
  ShieldCheck,
  LockKeyhole,
  Sparkles,
  Ghost,
  ChevronDown,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../components/AuthProvider';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { ConstellationBackground } from '../components/landing/ConstellationBackground';
import { ApiClientError } from '../lib/apiClient';
import { cn } from '../lib/utils';
import { BrandLogo } from '../components/BrandLogo';

/**
 * Public landing / welcome page — the first impression for a visitor. Premium
 * dark hero with an animated "constellation" backdrop (students connecting),
 * the AnonymousU wordmark in the display face, and clear separated CTAs.
 *
 * Flow:
 * - "Sign Up" → Google-only panel (creates account → onboarding)
 * - "Sign In" → Email + password panel (for returning users)
 */
export default function LandingPage() {
  const { user, isLoading, loginWithGoogle, loginWithEmail } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [activePanel, setActivePanel] = useState<'hero' | 'signup' | 'signin'>('hero');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Email+password form state (sign-in only)
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');

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

  const [mockupScreenIndex, setMockupScreenIndex] = useState(0);

  useEffect(() => {
    if (!mounted) return;
    const interval = setInterval(() => {
      setMockupScreenIndex((prev) => (prev + 1) % 3);
    }, 4000);
    return () => clearInterval(interval);
  }, [mounted]);

  const [mousePos, setMousePos] = useState({ x: 0, y: 0, active: false });

  const handleGlobalMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Calculate rotation between -15 and 15 degrees based on mouse position relative to entire screen
    const x = (e.clientX / window.innerWidth - 0.5) * 30;
    const y = (e.clientY / window.innerHeight - 0.5) * -30;
    setMousePos({ x, y, active: true });
  };

  const handleGlobalMouseLeave = () => {
    setMousePos({ x: 0, y: 0, active: false });
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentView = new URLSearchParams(window.location.search).get('view');
    if (currentView === 'signin') {
      setActivePanel('signin');
    } else if (currentView === 'signup') {
      setActivePanel('signup');
    }
  }, []);

  const setViewInUrl = useCallback(
    (view: 'signin' | 'signup' | null, mode: 'push' | 'replace' = 'replace') => {
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
      if (currentView === 'signin') {
        setActivePanel('signin');
      } else if (currentView === 'signup') {
        setActivePanel('signup');
      } else {
        setActivePanel('hero');
      }
      setError(null);
    };

    window.addEventListener('popstate', syncViewFromUrl);
    return () => window.removeEventListener('popstate', syncViewFromUrl);
  }, []);

  const openPanel = useCallback(
    (panel: 'signup' | 'signin') => {
      if (activePanel === panel) return;
      setActivePanel(panel);
      setError(null);
      setViewInUrl(panel, 'push');
    },
    [setViewInUrl, activePanel],
  );

  const backToHero = useCallback(() => {
    setActivePanel('hero');
    setError(null);
    setViewInUrl(null, 'push');
  }, [setViewInUrl]);

  /** Google credential handler (Sign Up flow). */
  const handleGoogleSignUp = useCallback(
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
              : 'Something went wrong signing you up. Please try again.',
          );
        })
        .finally(() => setPending(false));
    },
    [loginWithGoogle, router],
  );

  /** Google credential handler (Sign In flow — for users who skipped password setup). */
  const handleGoogleSignIn = useCallback(
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

  /** Email+password handler (Sign In flow). */
  const handleEmailSignIn = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      setError(null);
      setPending(true);
      loginWithEmail(emailInput.trim(), passwordInput)
        .then((signedInUser) => {
          router.replace(signedInUser.profileComplete ? '/match' : '/onboarding');
        })
        .catch((err: unknown) => {
          setError(err instanceof ApiClientError ? err.message : 'Invalid email or password.');
        })
        .finally(() => setPending(false));
    },
    [loginWithEmail, emailInput, passwordInput, router],
  );

  // While auth resolves (or a signed-in user is being redirected), render the
  // dark canvas only — avoids a flash of marketing content for logged-in users.
  const showContent = !isLoading && !user;

  // Calculate panel position: 0 = hero, 1 = signup, 2 = signin
  const panelIndex = activePanel === 'hero' ? 0 : activePanel === 'signup' ? 1 : 2;

  return (
    <div
      className="dark relative min-h-screen overflow-hidden bg-background text-foreground"
      onMouseMove={handleGlobalMouseMove}
      onMouseLeave={handleGlobalMouseLeave}
    >
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
              Anonymous<span className="text-brand">U</span>
            </span>
          </header>

          {/* Hero */}
          <main className="mx-auto flex flex-1 w-full max-w-7xl flex-col items-center justify-center px-space-5 py-space-6 text-center">
            {/* Top Section: Header & Tagline (Centered Full Width) */}
            <div className="flex flex-col items-center justify-center w-full">
              <div className="mb-space-7 flex justify-center" aria-label="AnonymousU logo mark">
                <div className="relative flex h-28 w-28 items-center justify-center">
                  <BrandLogo className="h-24 w-24 hover:scale-105 transition-transform" />
                </div>
              </div>

              <h1 className="font-display text-display tracking-tight lg:text-7xl">
                Anonymous<span className="text-brand">U</span>
              </h1>
              <p className="font-premium-cursive text-4xl md:text-5xl lg:text-6xl text-brand mt-space-8 mb-space-2 font-normal drop-shadow-sm select-none">
                a social media with privacy
              </p>
            </div>

            {/* Bottom Section: Split Content on Desktop */}
            <div className="flex flex-col-reverse lg:flex-row items-center justify-between w-full mt-space-8 gap-space-8">
              {/* Left Column: Forms */}
              <div className="flex flex-col items-center justify-center lg:w-1/2 w-full">
                <div className="w-full max-w-md overflow-hidden">
                  <div
                    className={cn(
                      'grid w-[300%] grid-cols-3 items-start transition-transform duration-700 ease-out',
                    )}
                    style={{ transform: `translateX(-${panelIndex * (100 / 3)}%)` }}
                  >
                    {/* ══════════════════════════ PANEL 1: Hero ══════════════════════════ */}
                    <section className="px-space-2 self-center">
                      <div className="flex flex-col items-center gap-space-4 sm:flex-row sm:justify-center">
                        <button
                          type="button"
                          onClick={() => openPanel('signup')}
                          className="inline-flex h-12 w-full sm:w-auto items-center justify-center rounded-button bg-brand px-space-8 text-body font-semibold text-brand-foreground transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          Sign Up
                        </button>
                        <button
                          type="button"
                          onClick={() => openPanel('signin')}
                          className="inline-flex h-12 w-full sm:w-auto items-center justify-center rounded-button border border-border/60 bg-transparent px-space-8 text-body font-semibold text-foreground transition-all hover:bg-foreground/5 hover:border-border/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                        >
                          Sign In
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
                                  mounted && activePanel === 'hero'
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

                    {/* ══════════════════════════ PANEL 2: Sign Up (Google only) ══════════════════════════ */}
                    <section className="px-space-2">
                      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-space-6 px-space-5 py-space-8">
                        <div className="w-full text-center flex flex-col gap-space-2">
                          <h2 className="text-h2 font-semibold text-foreground tracking-tight">
                            Create your account
                          </h2>
                          <p className="text-body text-muted-foreground px-space-4">
                            Use your campus email to join AnonymousU
                          </p>
                        </div>

                        {/* Google Sign-in (for Sign Up) */}
                        <div className="w-full my-space-2">
                          <GoogleSignInButton onCredential={handleGoogleSignUp} />
                        </div>

                        <p className="text-caption leading-relaxed text-muted-foreground text-center px-space-2">
                          Your institutional email verifies you&apos;re a real student.
                          <br />
                          We never post or share without your consent.
                        </p>

                        {pending && (
                          <p className="text-caption text-muted-foreground mt-space-2">
                            Creating your account...
                          </p>
                        )}
                        {error && (
                          <p className="text-caption text-danger mt-space-2" role="alert">
                            {error}
                          </p>
                        )}

                        <div className="flex flex-col items-center gap-space-4 mt-space-4 pt-space-4 border-t border-border/40 w-full">
                          <p className="text-small text-muted-foreground">
                            Already have an account?{' '}
                            <button
                              type="button"
                              onClick={() => openPanel('signin')}
                              className="text-brand hover:text-brand/80 transition-colors font-semibold"
                            >
                              Sign In
                            </button>
                          </p>
                          <button
                            type="button"
                            onClick={backToHero}
                            className="text-small font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            Back to welcome
                          </button>
                        </div>
                      </div>
                    </section>

                    {/* ══════════════════════════ PANEL 3: Sign In (Email + Password) ══════════════════════════ */}
                    <section className="px-space-2">
                      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-space-6 px-space-5 py-space-8">
                        <div className="w-full text-center flex flex-col gap-space-2">
                          <h2 className="text-h2 font-semibold text-foreground tracking-tight">
                            Welcome back
                          </h2>
                          <p className="text-body text-muted-foreground px-space-4">
                            Sign in with your email and password
                          </p>
                        </div>

                        {/* Email + Password Form */}
                        <form
                          className="flex w-full flex-col gap-space-4 my-space-2"
                          onSubmit={handleEmailSignIn}
                        >
                          <label className="flex flex-col gap-space-1.5">
                            <span className="text-small font-medium text-foreground">Email</span>
                            <input
                              type="email"
                              required
                              value={emailInput}
                              onChange={(e) => setEmailInput(e.target.value)}
                              placeholder="you@campus.edu"
                              className="h-11 rounded-button border border-border bg-surface px-space-4 text-body text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand transition-colors"
                            />
                          </label>
                          <label className="flex flex-col gap-space-1.5">
                            <span className="text-small font-medium text-foreground">Password</span>
                            <input
                              type="password"
                              required
                              value={passwordInput}
                              onChange={(e) => setPasswordInput(e.target.value)}
                              placeholder="••••••••"
                              className="h-11 rounded-button border border-border bg-surface px-space-4 text-body text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand transition-colors"
                            />
                          </label>
                          <button
                            type="submit"
                            disabled={pending}
                            className="h-11 mt-space-2 rounded-button bg-brand px-space-6 text-body font-semibold text-brand-foreground transition-transform hover:scale-[1.02] disabled:opacity-60"
                          >
                            {pending ? 'Signing in…' : 'Sign In'}
                          </button>
                        </form>

                        {/* Divider */}
                        <div className="relative flex items-center justify-center py-2 w-full">
                          <div className="absolute inset-0 flex items-center">
                            <span className="w-full border-t border-border/40" />
                          </div>
                          <span className="relative bg-background px-4 text-caption font-medium text-muted-foreground uppercase tracking-wider select-none">
                            or
                          </span>
                        </div>

                        {/* Google sign-in fallback (for users who skipped password setup) */}
                        <div className="w-full">
                          <GoogleSignInButton onCredential={handleGoogleSignIn} />
                        </div>

                        <p className="text-caption text-muted-foreground text-center px-space-4 leading-relaxed">
                          Use Google if you haven&apos;t set a password yet.
                        </p>

                        {error && (
                          <p className="text-caption text-danger mt-space-2" role="alert">
                            {error}
                          </p>
                        )}

                        <div className="flex flex-col items-center gap-space-4 mt-space-4 pt-space-4 border-t border-border/40 w-full">
                          <p className="text-small text-muted-foreground">
                            Don&apos;t have an account?{' '}
                            <button
                              type="button"
                              onClick={() => openPanel('signup')}
                              className="text-brand hover:text-brand/80 transition-colors font-semibold"
                            >
                              Sign Up
                            </button>
                          </p>
                          <button
                            type="button"
                            onClick={backToHero}
                            className="text-small font-medium text-muted-foreground transition-colors hover:text-foreground"
                          >
                            Back to welcome
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>

                {/* Close Left Column */}
              </div>

              {/* Right Column: 3D Isometric Screen Showcase */}
              <div
                className={cn(
                  'items-center justify-center relative min-h-[450px] lg:min-h-[550px] w-full lg:w-1/2 iphone-perspective mt-space-8 lg:mt-0 transition-opacity duration-500 scale-[0.85] lg:scale-100',
                  panelIndex === 0 ? 'flex' : 'hidden lg:flex',
                )}
              >
                {/* background decorative glowing blobs */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[350px] w-[350px] rounded-full bg-brand/10 blur-[80px]" />

                {/* Realistic 3D iPhone Mockup */}
                <div
                  className="relative w-[300px] h-[600px] preserve-3d z-10"
                  style={{ animation: 'iphone-float 6s infinite ease-in-out' }}
                >
                  <div
                    className="w-full h-full preserve-3d transition-transform duration-1000 ease-out"
                    style={{
                      transform: mousePos.active
                        ? `rotateY(${mousePos.x}deg) rotateX(${mousePos.y}deg) scale(1.08)`
                        : 'rotateY(-18deg) rotateX(10deg) rotateZ(4deg) scale(1)',
                    }}
                  >
                    {/* Outer Hardware Bezel */}
                    <div className="absolute inset-0 rounded-[3rem] border-[10px] border-[#1a1a1c] bg-[#000000] shadow-[15px_25px_50px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden">
                      {/* Dynamic Island / Notch */}
                      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-[100px] h-7 bg-black rounded-full z-50 flex items-center justify-between px-2.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-[#111] border border-white/5" />
                        <div className="w-3.5 h-3.5 rounded-full bg-[#0a0a2a] border border-blue-900/30 relative overflow-hidden">
                          <div className="absolute inset-0 bg-blue-500/20 rounded-full blur-[1px]" />
                        </div>
                      </div>

                      {/* Screen Content - App View */}
                      <div className="relative flex-1 bg-surface w-full h-full flex flex-col overflow-hidden pt-8">
                        {/* STATE 0: Campus Wall */}
                        <div
                          className={cn(
                            'absolute inset-0 pt-8 flex flex-col transition-opacity duration-1000 bg-background',
                            mockupScreenIndex === 0 ? 'opacity-100 z-20' : 'opacity-0 z-0',
                          )}
                        >
                          <div className="flex justify-between items-center px-5 py-3 border-b border-border/40 bg-surface/90 backdrop-blur-md z-30">
                            <span className="text-small font-semibold text-foreground">
                              Campus Wall
                            </span>
                          </div>
                          <div className="flex-1 relative overflow-hidden">
                            <div className="absolute top-0 left-0 w-full flex flex-col animate-feed-scroll hover:[animation-play-state:paused]">
                              {[0, 1].map((key) => (
                                <div key={key} className="flex flex-col">
                                  {/* Post 1 */}
                                  <div className="flex flex-col border-b border-border/40 bg-surface pb-4 mb-2">
                                    {/* Post Header */}
                                    <div className="flex items-center gap-3 p-3">
                                      <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center border border-brand/30">
                                        <span className="text-[10px] font-bold text-brand">AS</span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-small font-semibold text-foreground leading-tight">
                                          Anonymous Senior
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                          CS Department • 2h ago
                                        </span>
                                      </div>
                                    </div>

                                    {/* Post Media (Placeholder Image) */}
                                    <div className="w-full aspect-square bg-muted relative overflow-hidden group">
                                      <div className="absolute inset-0 bg-gradient-to-tr from-brand/20 to-blue-500/10" />
                                      <Image
                                        src="/logo.png"
                                        alt="post media"
                                        fill
                                        className="object-cover opacity-80 mix-blend-screen scale-110 group-hover:scale-100 transition-transform duration-700"
                                      />
                                      {/* Overlay gradient for aesthetics */}
                                      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/40" />
                                    </div>

                                    {/* Post Actions & Caption */}
                                    <div className="flex flex-col px-4 pt-3 gap-2">
                                      <div className="flex gap-4 items-center text-foreground/80">
                                        <span className="text-h2">♡</span>
                                        <span className="text-h3">💬</span>
                                        <span className="text-h3">↗</span>
                                      </div>
                                      <p className="text-caption text-foreground/90 mt-1">
                                        <span className="font-semibold mr-2">Anonymous Senior</span>
                                        Just uploaded all the notes and study guides for the
                                        upcoming DSA midterms into the shared drive. Good luck
                                        everyone! 📚✨
                                      </p>
                                      <p className="text-[10px] text-muted-foreground mt-1">
                                        View all 12 comments
                                      </p>
                                    </div>
                                  </div>

                                  {/* Post 2 */}
                                  <div className="flex flex-col border-b border-border/40 bg-surface pb-4 mb-2">
                                    <div className="flex items-center gap-3 p-3">
                                      <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                                        <span className="text-[10px] font-bold text-blue-500">
                                          AJ
                                        </span>
                                      </div>
                                      <div className="flex flex-col">
                                        <span className="text-small font-semibold text-foreground leading-tight">
                                          Anonymous Junior
                                        </span>
                                        <span className="text-[10px] text-muted-foreground">
                                          Design Dept • 5h ago
                                        </span>
                                      </div>
                                    </div>
                                    <div className="w-full aspect-square bg-muted relative overflow-hidden group">
                                      <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-brand/10" />
                                      <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-h3 font-display font-semibold text-foreground/80">
                                        Anyone going to the design meetup tonight? Looking for a
                                        squad! 🎨
                                      </div>
                                    </div>
                                    <div className="flex flex-col px-4 pt-3 gap-2">
                                      <div className="flex gap-4 items-center text-foreground/80">
                                        <span className="text-h2">♡</span>
                                        <span className="text-h3">💬</span>
                                        <span className="text-h3">↗</span>
                                      </div>
                                      <p className="text-caption text-foreground/90 mt-1">
                                        <span className="font-semibold mr-2">Anonymous Junior</span>
                                        Let me know!
                                      </p>
                                      <p className="text-[10px] text-muted-foreground mt-1">
                                        View all 4 comments
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* STATE 1: Match Radar */}
                        <div
                          className={cn(
                            'absolute inset-0 pt-8 flex flex-col bg-surface transition-opacity duration-1000',
                            mockupScreenIndex === 1 ? 'opacity-100 z-20' : 'opacity-0 z-0',
                          )}
                        >
                          <div className="flex justify-between items-center px-5 py-3 border-b border-border/40 bg-surface/80 backdrop-blur-sm">
                            <span className="text-small font-semibold text-brand">
                              Random Match
                            </span>
                            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                          </div>
                          <div className="flex-1 flex flex-col items-center justify-center gap-4">
                            <div className="relative flex items-center justify-center">
                              <div className="absolute inset-0 rounded-full border border-brand/40 animate-ping opacity-20 w-24 h-24" />
                              <div
                                className="absolute inset-0 rounded-full border border-brand/20 animate-ping opacity-10 w-32 h-32"
                                style={{ animationDelay: '500ms' }}
                              />
                              <div className="h-20 w-20 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center text-brand font-display text-h2 font-bold z-10 shadow-[0_0_20px_rgba(var(--brand),0.3)]">
                                U
                              </div>
                            </div>
                            <p className="text-body font-medium text-foreground mt-4 animate-pulse">
                              Finding a match...
                            </p>
                          </div>
                        </div>

                        {/* STATE 2: Anonymous Chat */}
                        <div
                          className={cn(
                            'absolute inset-0 pt-8 flex flex-col transition-opacity duration-1000',
                            mockupScreenIndex === 2 ? 'opacity-100 z-20' : 'opacity-0 z-0',
                          )}
                        >
                          <div className="flex justify-between items-center px-5 py-3 border-b border-border/40 bg-surface/80 backdrop-blur-sm">
                            <span className="text-small font-semibold text-foreground">
                              Anonymous Chat
                            </span>
                            <div className="h-6 w-6 rounded-full bg-brand flex items-center justify-center text-[10px] font-bold text-brand-foreground">
                              AU
                            </div>
                          </div>
                          <div className="flex-1 flex flex-col gap-3 p-5 overflow-hidden">
                            <div className="self-start max-w-[85%] p-3 rounded-2xl rounded-tl-sm bg-muted text-caption text-foreground">
                              Hey! Are you studying at the library right now?
                            </div>
                            <div className="self-end max-w-[85%] p-3 rounded-2xl rounded-tr-sm bg-brand text-caption text-brand-foreground">
                              Yeah, on the 3rd floor. Want to study together?
                            </div>
                            <div className="self-start max-w-[85%] p-3 rounded-2xl rounded-tl-sm bg-muted text-caption text-foreground">
                              Sure! I'll be there in 5 mins. Bring notes! 📚
                            </div>
                            <div className="self-end max-w-[85%] p-3 rounded-2xl rounded-tr-sm bg-brand text-caption text-brand-foreground shadow-sm">
                              Got em right here. See ya soon!
                            </div>
                          </div>
                          <div className="p-4 border-t border-border/40 bg-surface flex gap-2">
                            <div className="flex-1 h-9 rounded-full bg-muted/60 border border-border/40 px-3 flex items-center text-muted-foreground text-caption">
                              Message...
                            </div>
                            <div className="h-9 w-9 rounded-full bg-brand flex items-center justify-center text-brand-foreground shadow-sm">
                              ↑
                            </div>
                          </div>
                        </div>

                        {/* Home Indicator */}
                        <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 w-24 h-1 bg-foreground/20 rounded-full z-50" />
                      </div>
                    </div>

                    {/* Hardware Buttons */}
                    <div className="absolute top-28 -left-[13px] w-[3px] h-8 bg-[#2a2a2c] rounded-l-md" />
                    <div className="absolute top-44 -left-[13px] w-[3px] h-12 bg-[#2a2a2c] rounded-l-md" />
                    <div className="absolute top-60 -left-[13px] w-[3px] h-12 bg-[#2a2a2c] rounded-l-md" />
                    <div className="absolute top-44 -right-[13px] w-[3px] h-16 bg-[#2a2a2c] rounded-r-md" />
                  </div>
                </div>
              </div>
              {/* Close Bottom Section container */}
            </div>

            {/* Scroll Indicator */}
            <div className="w-full flex justify-center pb-12 mt-20">
              <div className="flex flex-col items-center gap-2 animate-bounce opacity-50 hover:opacity-100 transition-opacity cursor-pointer">
                <span className="text-caption font-medium uppercase tracking-widest">
                  Scroll to explore
                </span>
                <ChevronDown className="h-5 w-5" />
              </div>
            </div>
          </main>

          {/* Features Bento Grid */}
          <section className="w-full max-w-6xl mx-auto px-space-5 py-24 relative z-10">
            <div className="text-center mb-16">
              <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight mb-4">
                Everything you need.
                <br />
                Nothing you don't.
              </h2>
              <p className="text-muted-foreground text-body max-w-2xl mx-auto">
                Campus life is complicated enough. Your social network shouldn't be. Experience a
                cleaner, safer, and more authentic way to connect.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Feature 1: Large */}
              <div className="group md:col-span-2 relative overflow-hidden rounded-[2rem] bg-surface border border-border/40 p-10 hover:border-brand/50 transition-colors">
                <div className="absolute inset-0 bg-gradient-to-br from-brand/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <Ghost className="h-10 w-10 text-brand mb-6" />
                <h3 className="text-h3 font-bold mb-3">True Anonymity</h3>
                <p className="text-muted-foreground max-w-md">
                  Your identity is completely hidden until you decide otherwise. Express yourself
                  freely, ask the embarrassing questions, and be your authentic self without fear of
                  judgment.
                </p>
              </div>

              {/* Feature 2: Small */}
              <div className="group relative overflow-hidden rounded-[2rem] bg-surface border border-border/40 p-10 hover:border-brand/50 transition-colors">
                <Building2 className="h-10 w-10 text-blue-500 mb-6" />
                <h3 className="text-h3 font-bold mb-3">Campus Exclusive</h3>
                <p className="text-muted-foreground">
                  Verified by .edu email. No outsiders, no bots.
                </p>
              </div>

              {/* Feature 3: Small */}
              <div className="group relative overflow-hidden rounded-[2rem] bg-surface border border-border/40 p-10 hover:border-brand/50 transition-colors">
                <Sparkles className="h-10 w-10 text-emerald-500 mb-6" />
                <h3 className="text-h3 font-bold mb-3">Smart Matching</h3>
                <p className="text-muted-foreground">
                  Find study buddies or dates instantly based on your exact vibe.
                </p>
              </div>

              {/* Feature 4: Large */}
              <div className="group md:col-span-2 relative overflow-hidden rounded-[2rem] bg-surface border border-border/40 p-10 hover:border-brand/50 transition-colors">
                <div className="absolute inset-0 bg-gradient-to-tl from-purple-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <MessageCircle className="h-10 w-10 text-purple-500 mb-6" />
                <h3 className="text-h3 font-bold mb-3">The Campus Wall</h3>
                <p className="text-muted-foreground max-w-md">
                  A real-time, completely anonymous feed of campus gossip, memes, and important
                  updates. It's the pulse of your university, right in your pocket.
                </p>
              </div>
            </div>
          </section>

          {/* Privacy & Data Safety */}
          <section className="w-full bg-[#0a0a0c] border-y border-border/40 py-32 relative overflow-hidden z-10">
            {/* Soft background glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-1/2 bg-brand/10 blur-[120px] rounded-full pointer-events-none" />

            <div className="max-w-4xl mx-auto px-space-5 relative z-10 text-center">
              <ShieldCheck className="h-16 w-16 text-brand mx-auto mb-8 animate-pulse" />
              <h2 className="font-display text-5xl md:text-7xl font-bold tracking-tight mb-8">
                Your data is yours.
              </h2>
              <p className="text-xl text-muted-foreground mb-16 leading-relaxed">
                We believe privacy is a fundamental human right. AnonymousU is built from the ground
                up to protect your identity and your data.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-left">
                <div className="flex flex-col gap-3 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md hover:-translate-y-1 transition-transform">
                  <LockKeyhole className="h-6 w-6 text-brand" />
                  <h4 className="font-bold text-foreground">Zero Tracking</h4>
                  <p className="text-caption text-foreground/70">
                    We don't track your location, and we never sell your data to advertisers.
                  </p>
                </div>
                <div className="flex flex-col gap-3 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md hover:-translate-y-1 transition-transform">
                  <Eye className="h-6 w-6 text-brand" />
                  <h4 className="font-bold text-foreground">Untraceable Accounts</h4>
                  <p className="text-caption text-foreground/70">
                    Your .edu email is only used for verification and is cryptographically hashed.
                  </p>
                </div>
                <div className="flex flex-col gap-3 p-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md hover:-translate-y-1 transition-transform">
                  <MessageCircle className="h-6 w-6 text-brand" />
                  <h4 className="font-bold text-foreground">Encrypted Chats</h4>
                  <p className="text-caption text-foreground/70">
                    Your conversations are securely encrypted and can only be read by you and your
                    match.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* Bottom CTA & Footer */}
          <footer className="w-full flex flex-col items-center pt-32 pb-10 px-space-5 relative overflow-hidden z-10">
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-[400px] bg-gradient-to-t from-brand/20 to-transparent blur-[80px] pointer-events-none" />

            <div className="text-center z-10 mb-32">
              <h2 className="font-display text-5xl md:text-6xl font-bold tracking-tight mb-8">
                Ready to join?
              </h2>
              <button
                onClick={() => {
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  setTimeout(() => setViewInUrl('signup'), 500);
                }}
                className="h-14 px-8 rounded-full bg-brand text-brand-foreground font-bold text-lg hover:scale-105 transition-transform shadow-[0_0_30px_rgba(var(--brand),0.3)]"
              >
                Create your account
              </button>
            </div>

            <div className="w-full max-w-6xl flex flex-col md:flex-row items-center justify-between pt-8 border-t border-border/40 text-caption text-muted-foreground z-10">
              <div className="flex items-center gap-2 mb-4 md:mb-0">
                <BrandLogo className="h-5 w-5 grayscale opacity-50" />
                <span>© 2026 AnonymousU. All rights reserved.</span>
              </div>
              <div className="flex gap-6">
                <a href="#" className="hover:text-foreground transition-colors">
                  Privacy Policy
                </a>
                <a href="#" className="hover:text-foreground transition-colors">
                  Terms of Service
                </a>
                <a href="#" className="hover:text-foreground transition-colors">
                  Community Guidelines
                </a>
              </div>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}
