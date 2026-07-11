'use client';

import { useEffect, useState } from 'react';
import {
  Users,
  UserCheck,
  Flag,
  FileText,
  Building2,
  CreditCard,
  type LucideIcon,
} from 'lucide-react';
import type { DashboardMetrics, FeatureFlag, Announcement } from '@campusly/shared-types';
import { ADMIN_ROLES } from '@campusly/shared-types';
import { useAuth } from '../../components/AuthProvider';
import { adminApi } from '../../lib/admin';
import { StatCard } from '../../components/admin/StatCard';
import { Card, CardTitle } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Textarea } from '../../components/ui/Textarea';
import { Badge } from '../../components/ui/Badge';
import { cn } from '../../lib/utils';

/**
 * Admin dashboard (Req 10). Rendered inside the guarded `/admin` layout, so it
 * neither renders the student `AppNav` nor its own auth redirect — `AdminShell`
 * provides the chrome and the layout enforces moderator+ access.
 *
 * Moderators reach this page but the metrics + config endpoints are admin-only,
 * so the dashboard fetch and the feature-flag/announcement panels are gated
 * behind `isAdmin`.
 */
export default function AdminDashboardPage() {
  const { user } = useAuth();
  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;

  return (
    <div className="flex flex-col gap-space-6">
      <div className="flex flex-col gap-space-1">
        <h1 className="text-h1 text-foreground">Dashboard</h1>
        <p className="text-body text-muted-foreground">
          Keep Campusly safe and well-run at a glance.
        </p>
      </div>

      {isAdmin ? (
        <>
          <DashboardMetricsGrid />
          <FeatureFlagsSection />
          <AnnouncementsSection />
        </>
      ) : (
        <Card>
          <p className="text-body text-muted-foreground">
            Platform metrics are available to admins. Head to Reports to work the moderation queue.
          </p>
        </Card>
      )}
    </div>
  );
}

interface MetricSpec {
  key: keyof DashboardMetrics;
  label: string;
  icon: LucideIcon;
  emphasis?: 'default' | 'highlight';
}

const METRIC_SPECS: MetricSpec[] = [
  { key: 'totalUsers', label: 'Total users', icon: Users },
  { key: 'activeUsers', label: 'Active users', icon: UserCheck },
  { key: 'pendingReports', label: 'Pending reports', icon: Flag, emphasis: 'highlight' },
  { key: 'postsToday', label: 'Posts today', icon: FileText },
  { key: 'communities', label: 'Communities', icon: Building2 },
  { key: 'premiumUsers', label: 'Premium users', icon: CreditCard },
];

function DashboardMetricsGrid() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);

  useEffect(() => {
    void adminApi.dashboard().then(setMetrics);
  }, []);

  if (!metrics) {
    return <p className="text-caption text-muted-foreground">Loading metrics…</p>;
  }

  return (
    <section aria-label="Platform metrics" className="grid grid-cols-2 gap-space-3 md:grid-cols-3">
      {METRIC_SPECS.map((spec) => (
        <StatCard
          key={spec.key}
          label={spec.label}
          value={metrics[spec.key].toLocaleString()}
          icon={spec.icon}
          emphasis={spec.emphasis}
        />
      ))}
    </section>
  );
}

function FeatureFlagsSection() {
  const [flags, setFlags] = useState<FeatureFlag[]>([]);

  useEffect(() => {
    void adminApi.flags().then(setFlags);
  }, []);

  const toggle = async (flag: FeatureFlag) => {
    const updated = await adminApi.setFlag(flag.key, !flag.isEnabled);
    setFlags((prev) => prev.map((x) => (x.key === flag.key ? updated : x)));
  };

  return (
    <section aria-label="Feature flags" className="flex flex-col gap-space-3">
      <h2 className="text-h3 text-foreground">Feature flags</h2>
      {flags.length === 0 ? (
        <p className="text-caption text-muted-foreground">No feature flags configured.</p>
      ) : (
        <div className="flex flex-col gap-space-2">
          {flags.map((flag) => (
            <Card key={flag.key} className="flex items-center justify-between gap-space-3">
              <div className="flex flex-col">
                <span className="text-body text-foreground">{flag.key}</span>
                {flag.description ? (
                  <span className="text-small text-muted-foreground">{flag.description}</span>
                ) : null}
              </div>
              <div className="flex items-center gap-space-2">
                <Badge variant={flag.isEnabled ? 'success' : 'neutral'}>
                  {flag.isEnabled ? 'Enabled' : 'Disabled'}
                </Badge>
                <Button
                  size="sm"
                  variant={flag.isEnabled ? 'ghost' : 'secondary'}
                  onClick={() => void toggle(flag)}
                >
                  {flag.isEnabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function AnnouncementsSection() {
  const [list, setList] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const load = () => void adminApi.announcements().then(setList);
  useEffect(load, []);

  const canPublish = title.trim().length > 0 && body.trim().length > 0;

  const create = async () => {
    if (!canPublish) return;
    await adminApi.createAnnouncement({ title, body, audience: 'all', campusScoped: false });
    setTitle('');
    setBody('');
    load();
  };

  return (
    <section aria-label="Announcements" className="flex flex-col gap-space-3">
      <h2 className="text-h3 text-foreground">Announcements</h2>
      <Card className="flex flex-col gap-space-2">
        <CardTitle>New announcement</CardTitle>
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
        <Button className="self-end" size="sm" onClick={() => void create()} disabled={!canPublish}>
          Publish
        </Button>
      </Card>
      {list.map((a) => (
        <Card key={a.id} className={cn('flex flex-col gap-space-1')}>
          <span className="text-body font-medium text-foreground">{a.title}</span>
          <span className="text-small text-muted-foreground">{a.body}</span>
        </Card>
      ))}
    </section>
  );
}
