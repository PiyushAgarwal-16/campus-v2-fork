'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowLeft,
  LayoutDashboard,
  Flag,
  Users,
  CreditCard,
  Search,
  ScrollText,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react';
import { ADMIN_ROLES, MODERATOR_ROLES } from '@campusly/shared-types';
import { useAuth } from '../AuthProvider';
import { cn } from '../../lib/utils';

/** A single sidebar destination with the minimum role tier that may see it. */
interface AdminNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** 'moderator' → visible to MODERATOR_ROLES; 'admin' → visible to ADMIN_ROLES. */
  tier: 'moderator' | 'admin';
}

const NAV_ITEMS: AdminNavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard, tier: 'moderator' },
  { label: 'Reports', href: '/admin/reports', icon: Flag, tier: 'moderator' },
  { label: 'Users', href: '/admin/users', icon: Users, tier: 'admin' },
  { label: 'Subscriptions', href: '/admin/subscriptions', icon: CreditCard, tier: 'admin' },
  { label: 'Inspector', href: '/admin/inspector', icon: Search, tier: 'admin' },
  { label: 'Audit', href: '/admin/audit', icon: ScrollText, tier: 'admin' },
];

/**
 * AdminShell — the admin console shell (Req 2.1, 15.x).
 *
 * Renders a tier-aware sidebar (desktop) / collapsible nav (mobile) plus a main
 * content area. It never renders the student `AppNav`. Links are shown based on
 * the current user's role tier: moderators see Dashboard + Reports only; admins
 * and super admins see every link. Client gating here is presentation only —
 * the server remains the authoritative authorization gate.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isAdmin = user !== null && ADMIN_ROLES.includes(user.role);
  const isModerator = user !== null && MODERATOR_ROLES.includes(user.role);

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.tier === 'admin') return isAdmin;
    return isModerator;
  });

  const isActive = (href: string): boolean => {
    if (href === '/admin') return pathname === '/admin';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const renderLinks = (onNavigate?: () => void): ReactNode =>
    visibleItems.map((item) => {
      const Icon = item.icon;
      const active = isActive(item.href);
      return (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'flex min-h-11 items-center gap-space-3 rounded-button px-space-3 py-space-2 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            active
              ? 'bg-brand/10 text-brand'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      );
    });

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top header (all viewports) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-background px-space-4 py-space-3">
        <div className="flex items-center gap-space-3">
          <button
            type="button"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label={mobileOpen ? 'Close admin menu' : 'Open admin menu'}
            aria-expanded={mobileOpen}
            className="inline-flex h-11 w-11 items-center justify-center rounded-button text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background md:hidden"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" aria-hidden="true" />
            ) : (
              <Menu className="h-5 w-5" aria-hidden="true" />
            )}
          </button>
          <span className="text-h3 font-semibold text-foreground">Admin</span>
        </div>
        <Link
          href="/wall"
          className="inline-flex min-h-11 items-center gap-space-2 rounded-button px-space-3 py-space-2 text-caption font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          <span>Back to app</span>
        </Link>
      </header>

      <div className="flex">
        {/* Desktop sidebar */}
        <aside className="hidden w-64 shrink-0 border-r border-border md:block">
          <nav
            aria-label="Admin navigation"
            className="sticky top-[65px] flex flex-col gap-space-1 p-space-3"
          >
            {renderLinks()}
          </nav>
        </aside>

        {/* Mobile collapsible nav */}
        {mobileOpen ? (
          <nav
            aria-label="Admin navigation"
            className="absolute inset-x-0 z-20 flex flex-col gap-space-1 border-b border-border bg-background p-space-3 md:hidden"
          >
            {renderLinks(() => setMobileOpen(false))}
          </nav>
        ) : null}

        {/* Main content */}
        <main className="min-w-0 flex-1 p-space-4 md:p-space-6">{children}</main>
      </div>
    </div>
  );
}
