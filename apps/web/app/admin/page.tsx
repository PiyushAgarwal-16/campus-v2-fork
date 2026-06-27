'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  AdminReport,
  AdminUser,
  DashboardMetrics,
  FeatureFlag,
  Announcement,
  AuditLogItem,
  ModerationActionType,
} from '@campusly/shared-types';
import { MODERATOR_ROLES, ADMIN_ROLES } from '@campusly/shared-types';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { adminApi } from '../../lib/admin';
import { AppNav } from '../../components/AppNav';
import { Card, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { cn } from '../../lib/utils';

type Tab = 'dashboard' | 'reports' | 'users' | 'flags' | 'announcements' | 'audit';

/**
 * Admin & moderation panel (ADMIN_PANEL.md). Role-gated: moderators see the
 * report queue; admins see everything. The server enforces RBAC regardless.
 */
export default function AdminPage() {
  const { user, isLoading } = useRequireAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('dashboard');

  const isModerator = user ? MODERATOR_ROLES.includes(user.role) : false;
  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;

  useEffect(() => {
    if (!isLoading && user && !isModerator) router.replace('/');
  }, [isLoading, user, isModerator, router]);

  if (isLoading || !user || !isModerator) return null;

  const tabs: Tab[] = isAdmin
    ? ['dashboard', 'reports', 'users', 'flags', 'announcements', 'audit']
    : ['reports'];

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-space-5 px-space-4 py-space-8 md:px-space-8">
      <AppNav />
      <div className="flex flex-col gap-space-1">
        <h1 className="text-h1 text-foreground">Admin</h1>
        <p className="text-body text-muted-foreground">Keep Campusly safe and well-run.</p>
      </div>

      <div className="flex flex-wrap gap-space-2">
        {tabs.map((t) => (
          <Button
            key={t}
            variant={tab === t ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </Button>
        ))}
      </div>

      {tab === 'dashboard' && isAdmin && <DashboardTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'users' && isAdmin && <UsersTab />}
      {tab === 'flags' && isAdmin && <FlagsTab />}
      {tab === 'announcements' && isAdmin && <AnnouncementsTab />}
      {tab === 'audit' && isAdmin && <AuditTab />}
    </main>
  );
}

function DashboardTab() {
  const [m, setM] = useState<DashboardMetrics | null>(null);
  useEffect(() => {
    void adminApi.dashboard().then(setM);
  }, []);
  if (!m) return <p className="text-caption text-muted-foreground">Loading…</p>;
  const panels: [string, number][] = [
    ['Total users', m.totalUsers],
    ['Active users', m.activeUsers],
    ['Pending reports', m.pendingReports],
    ['Posts today', m.postsToday],
    ['Communities', m.communities],
    ['Premium users', m.premiumUsers],
  ];
  return (
    <div className="grid grid-cols-2 gap-space-3 md:grid-cols-3">
      {panels.map(([label, value]) => (
        <Card key={label} className="flex flex-col gap-space-1">
          <span className="text-small text-muted-foreground">{label}</span>
          <span
            className={cn('text-h2', label === 'Pending reports' && value > 0 && 'text-warning')}
          >
            {value}
          </span>
        </Card>
      ))}
    </div>
  );
}

function ReportsTab() {
  const [reports, setReports] = useState<AdminReport[]>([]);
  const load = () => void adminApi.reports().then((r) => setReports(r.reports));
  useEffect(load, []);

  const act = async (r: AdminReport, action: ModerationActionType) => {
    await adminApi.applyAction({
      targetType: r.targetType as ApplyTarget,
      targetId: r.targetId,
      action,
      reportId: r.id,
      ...(action === 'ban' ? { durationHours: 24 } : {}),
    });
    load();
  };
  const dismiss = async (r: AdminReport) => {
    await adminApi.resolveReport(r.id, 'dismissed');
    load();
  };

  if (reports.length === 0) {
    return (
      <p className="py-space-8 text-center text-caption text-muted-foreground">Queue is clear 🎉</p>
    );
  }
  return (
    <div className="flex flex-col gap-space-3">
      {reports.map((r) => (
        <Card key={r.id} className="flex flex-col gap-space-2">
          <div className="flex items-center justify-between">
            <CardTitle>{r.targetType.replace('_', ' ')}</CardTitle>
            <span className="rounded-tooltip bg-surface px-space-2 py-0.5 text-small text-danger">
              {r.reason}
            </span>
          </div>
          <span className="break-all text-small text-muted-foreground">target: {r.targetId}</span>
          {r.details && <p className="text-body text-foreground">{r.details}</p>}
          <div className="flex flex-wrap gap-space-2 border-t border-border pt-space-2">
            <Button size="sm" variant="ghost" onClick={() => void dismiss(r)}>
              Dismiss
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void act(r, 'remove_content')}>
              Remove content
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void act(r, 'warn')}>
              Warn
            </Button>
            <Button size="sm" variant="danger" onClick={() => void act(r, 'ban')}>
              Suspend 24h
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

type ApplyTarget =
  | 'user'
  | 'wall_post'
  | 'wall_reply'
  | 'community_post'
  | 'message'
  | 'marketplace_item'
  | 'lost_found_item';

function UsersTab() {
  const [q, setQ] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const load = (query?: string) => void adminApi.users(query).then((r) => setUsers(r.users));
  useEffect(() => load(), []);

  const setStatus = async (u: AdminUser, status: 'active' | 'suspended' | 'banned') => {
    await adminApi.setUserStatus(
      u.id,
      status === 'suspended' ? { status, durationHours: 24 } : { status },
    );
    load(q);
  };

  return (
    <div className="flex flex-col gap-space-3">
      <div className="flex gap-space-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or email"
        />
        <Button size="sm" onClick={() => load(q)}>
          Search
        </Button>
      </div>
      {users.map((u) => (
        <Card key={u.id} className="flex items-center justify-between gap-space-3">
          <div className="flex flex-col">
            <span className="text-body text-foreground">{u.name}</span>
            <span className="text-small text-muted-foreground">
              {u.email} · {u.role} · {u.accountStatus}
            </span>
          </div>
          <div className="flex gap-space-1">
            {u.accountStatus === 'active' ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => void setStatus(u, 'suspended')}>
                  Suspend
                </Button>
                <Button size="sm" variant="danger" onClick={() => void setStatus(u, 'banned')}>
                  Ban
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => void setStatus(u, 'active')}>
                Restore
              </Button>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

function FlagsTab() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  useEffect(() => {
    void adminApi.flags().then(setFlags);
  }, []);
  const toggle = async (f: FeatureFlag) => {
    const updated = await adminApi.setFlag(f.key, !f.isEnabled);
    setFlags((prev) => prev.map((x) => (x.key === f.key ? updated : x)));
  };
  return (
    <div className="flex flex-col gap-space-2">
      {flags.map((f) => (
        <Card key={f.key} className="flex items-center justify-between gap-space-3">
          <div className="flex flex-col">
            <span className="text-body text-foreground">{f.key}</span>
            {f.description && (
              <span className="text-small text-muted-foreground">{f.description}</span>
            )}
          </div>
          <Button
            size="sm"
            variant={f.isEnabled ? 'secondary' : 'ghost'}
            onClick={() => void toggle(f)}
          >
            {f.isEnabled ? 'Enabled' : 'Disabled'}
          </Button>
        </Card>
      ))}
    </div>
  );
}

function AnnouncementsTab() {
  const [list, setList] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const load = () => void adminApi.announcements().then(setList);
  useEffect(load, []);
  const create = async () => {
    if (!title.trim() || !body.trim()) return;
    await adminApi.createAnnouncement({ title, body, audience: 'all', campusScoped: false });
    setTitle('');
    setBody('');
    load();
  };
  return (
    <div className="flex flex-col gap-space-3">
      <Card className="flex flex-col gap-space-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          maxLength={160}
        />
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message"
          maxLength={4000}
        />
        <Button
          className="self-end"
          size="sm"
          onClick={() => void create()}
          disabled={!title.trim() || !body.trim()}
        >
          Publish
        </Button>
      </Card>
      {list.map((a) => (
        <Card key={a.id} className="flex flex-col gap-space-1">
          <span className="text-body font-medium text-foreground">{a.title}</span>
          <span className="text-small text-muted-foreground">{a.body}</span>
        </Card>
      ))}
    </div>
  );
}

function AuditTab() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  useEffect(() => {
    void adminApi.auditLogs().then((r) => setLogs(r.logs));
  }, []);
  return (
    <div className="flex flex-col gap-space-1">
      {logs.map((l) => (
        <Card key={l.id} className="flex items-center justify-between gap-space-2 py-space-2">
          <span className="text-small text-foreground">{l.action}</span>
          <span className="text-small text-muted-foreground">
            {new Date(l.createdAt).toLocaleString()}
          </span>
        </Card>
      ))}
      {logs.length === 0 && (
        <p className="text-caption text-muted-foreground">No audit entries yet.</p>
      )}
    </div>
  );
}
