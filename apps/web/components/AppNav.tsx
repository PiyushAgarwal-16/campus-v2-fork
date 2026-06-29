'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { Button } from './ui/Button';
import { ThemeToggle } from './ThemeToggle';
import { Building2, Zap, Users, User, Settings, ShieldAlert, LogOut } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Premium, fully responsive navigation with Apple-style glassmorphism.
 * - Desktop: Sticky top header bar with text links, active highlighting, theme toggle, and Sign Out.
 * - Mobile: Minimal top bar and a floating glass dock navigation bar with icons for app-like UX.
 */
export function AppNav() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const isStaff =
    user !== null &&
    (user.role === 'moderator' || user.role === 'admin' || user.role === 'super_admin');

  const signOut = () => {
    void logout().then(() => router.replace('/?view=signin'));
  };

  const navItems = [
    { label: 'Match', href: '/match', icon: Zap },
    { label: 'Wall', href: '/wall', icon: Building2 },
    { label: 'Friends', href: '/friends', icon: Users },
    { label: 'Profile', href: '/profile', icon: User },
    { label: 'Settings', href: '/settings', icon: Settings },
  ];

  return (
    <>
      {/* Top Header Bar (Desktop & Mobile Top Info) */}
      <header className="flex w-full items-center justify-between border-b border-border bg-background/80 py-space-3 backdrop-blur-md sticky top-0 z-30 px-space-4">
        <Link
          href="/match"
          className="font-display text-h3 font-bold tracking-tight text-foreground hover:opacity-90 select-none"
        >
          Campus<span className="text-brand">ly</span>
        </Link>

        {/* Desktop Links (Hidden on Mobile) */}
        <nav className="hidden md:flex items-center gap-space-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'text-caption font-medium transition-all duration-200 flex items-center gap-space-1.5 px-space-3 py-1.5 rounded-button border',
                  isActive
                    ? 'text-brand bg-brand/10 border-brand/20 shadow-[0_2px_8px_rgba(255,153,0,0.12)] backdrop-blur-md'
                    : 'text-muted-foreground border-transparent hover:text-foreground hover:bg-foreground/5 hover:border-foreground/10',
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
          {isStaff && (
            <Link
              href="/admin"
              className={cn(
                'text-caption font-medium transition-all duration-200 flex items-center gap-space-1.5 px-space-3 py-1.5 rounded-button border',
                pathname === '/admin' || pathname.startsWith('/admin/')
                  ? 'text-brand bg-brand/10 border-brand/20 shadow-[0_2px_8px_rgba(255,153,0,0.12)] backdrop-blur-md'
                  : 'text-danger border-transparent hover:bg-danger/5 hover:border-danger/10',
              )}
            >
              <ShieldAlert className="h-4 w-4" />
              <span>Admin</span>
            </Link>
          )}
        </nav>

        {/* Action Controls */}
        <div className="flex items-center gap-space-2">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={signOut}
            className="h-9 w-9 p-0 md:h-auto md:w-auto md:px-space-4 md:py-space-2 text-muted-foreground hover:text-foreground transition-all rounded-button border border-transparent hover:border-border/60 hover:bg-foreground/5"
            aria-label="Sign out"
          >
            <span className="hidden md:inline">Sign out</span>
            <LogOut className="h-4 w-4 md:hidden" />
          </Button>
        </div>
      </header>

      {/* Mobile Floating Glass Dock (Hidden on Desktop) */}
      <div className="md:hidden fixed bottom-6 left-4 right-4 z-40">
        <nav className="flex items-center justify-around h-14 px-space-2 rounded-full border border-border/40 bg-background/70 backdrop-blur-lg shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex flex-col items-center justify-center w-11 h-11 rounded-full transition-all duration-200 relative border',
                  isActive
                    ? 'text-brand bg-brand/10 border-brand/20 shadow-[0_2px_8px_rgba(255,153,0,0.12)] backdrop-blur-md scale-105'
                    : 'text-muted-foreground bg-foreground/[0.03] border-foreground/[0.08] active:scale-95',
                )}
              >
                <Icon className="h-5 w-5" />
                {/* Active indicator bar */}
                {isActive && (
                  <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-brand shadow-[0_0_8px_#FF9900]" />
                )}
              </Link>
            );
          })}
          {isStaff && (
            <Link
              href="/admin"
              className={cn(
                'flex flex-col items-center justify-center w-11 h-11 rounded-full transition-all duration-200 relative border',
                pathname === '/admin' || pathname.startsWith('/admin/')
                  ? 'text-brand bg-brand/10 border-brand/20 shadow-[0_2px_8px_rgba(255,153,0,0.12)] backdrop-blur-md scale-105'
                  : 'text-danger bg-foreground/[0.03] border-foreground/[0.08] active:scale-95',
              )}
            >
              <ShieldAlert className="h-5 w-5" />
              {(pathname === '/admin' || pathname.startsWith('/admin/')) && (
                <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-brand shadow-[0_0_8px_#FF9900]" />
              )}
            </Link>
          )}
        </nav>
      </div>
    </>
  );
}
