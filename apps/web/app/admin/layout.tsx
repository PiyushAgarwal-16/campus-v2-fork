'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { MODERATOR_ROLES } from '@campusly/shared-types';
import { useAuth } from '../../components/AuthProvider';
import { AdminShell } from '../../components/admin/AdminShell';

/**
 * Guarded layout for the entire /admin route group (ADMIN_PANEL.md §2, Req 2).
 *
 * This client-side gating is presentation only: it decides what to render and
 * where to redirect. Real authorization is always enforced server-side from the
 * verified access-token claims (Req 2.5); the client can never grant access on
 * its own. Deliberately does NOT render the student `AppNav` (Req 2.1) — the
 * admin surface has its own chrome via `AdminShell`.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  const isPrivileged = user ? MODERATOR_ROLES.includes(user.role) : false;

  useEffect(() => {
    if (isLoading) return;
    // Unauthenticated → send to sign-in (matches useRequireAuth). (Req 2.4)
    if (!user) {
      router.replace('/?view=signin');
      return;
    }
    // Authenticated but not a moderator/admin → bounce to the app root. (Req 2.3)
    if (!isPrivileged) {
      router.replace('/');
    }
  }, [isLoading, user, isPrivileged, router]);

  // While resolving the session, or when access is denied, render nothing so no
  // admin content flashes before the redirect completes.
  if (isLoading || !user || !isPrivileged) return null;

  // AdminShell reads role from useAuth itself for tier-aware navigation.
  return <AdminShell>{children}</AdminShell>;
}
