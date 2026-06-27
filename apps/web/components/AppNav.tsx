'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import { Button } from './ui/Button';
import { ThemeToggle } from './ThemeToggle';

/**
 * Minimal top navigation for authenticated pages (UI_GUIDELINES.md §11:
 * simple, predictable). Primary surfaces grow here in later phases.
 */
export function AppNav() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const isStaff =
    user !== null &&
    (user.role === 'moderator' || user.role === 'admin' || user.role === 'super_admin');

  const signOut = () => {
    void logout().then(() => router.replace('/signin'));
  };

  return (
    <header className="flex items-center justify-between gap-space-4">
      <nav className="flex items-center gap-space-4">
        <Link href="/" className="text-h3 font-semibold text-brand">
          Campusly
        </Link>
        <Link href="/wall" className="text-body text-muted-foreground hover:text-foreground">
          Wall
        </Link>
        <Link href="/match" className="text-body text-muted-foreground hover:text-foreground">
          Match
        </Link>
        <Link href="/friends" className="text-body text-muted-foreground hover:text-foreground">
          Friends
        </Link>
        <Link href="/communities" className="text-body text-muted-foreground hover:text-foreground">
          Communities
        </Link>
        <Link href="/profile" className="text-body text-muted-foreground hover:text-foreground">
          Profile
        </Link>
        <Link href="/settings" className="text-body text-muted-foreground hover:text-foreground">
          Settings
        </Link>
        {isStaff && (
          <Link href="/admin" className="text-body text-brand hover:text-brand/80">
            Admin
          </Link>
        )}
      </nav>
      <div className="flex items-center gap-space-2">
        <ThemeToggle />
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </header>
  );
}
