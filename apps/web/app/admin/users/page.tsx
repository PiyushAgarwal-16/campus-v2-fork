'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, Pencil, Plus, RotateCcw, Search, ShieldAlert, Sparkles, Trash2 } from 'lucide-react';
import {
  ADMIN_ROLES,
  SUPER_ADMIN_ROLES,
  USER_ROLES,
  type AdminUser,
  type SubscriptionPlan,
  type UniversityOption,
  type UserRole,
  type UserSubscriptionState,
} from '@campusly/shared-types';
import { useAuth } from '../../../components/AuthProvider';
import { adminApi } from '../../../lib/admin';
import { ApiClientError } from '../../../lib/apiClient';
import { cn } from '../../../lib/utils';
import { Card, CardTitle, CardDescription } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Textarea } from '../../../components/ui/Textarea';
import { Select } from '../../../components/ui/Select';
import { Badge } from '../../../components/ui/Badge';
import { Dialog } from '../../../components/ui/Dialog';
import { DataTable, type DataTableColumn } from '../../../components/admin/DataTable';
import { ConfirmDialog } from '../../../components/admin/ConfirmDialog';

/** Maps an account status to a Badge variant for at-a-glance triage. */
function statusVariant(status: AdminUser['accountStatus']) {
  switch (status) {
    case 'active':
      return 'success' as const;
    case 'banned':
    case 'suspended':
      return 'danger' as const;
    case 'restricted':
    case 'pending_verification':
      return 'warning' as const;
    default:
      return 'neutral' as const;
  }
}

/**
 * Admin user management (ADMIN_PANEL.md §4, Requirements 4, 5, 6, 9, 12).
 *
 * Rendered inside the guarded /admin layout (AdminShell) — this page renders no
 * AppNav and performs no auth redirect of its own. Client role gating here is
 * presentation only; the server enforces RBAC on every request. Super-admin-only
 * actions (role change, soft delete) are hidden for non-super-admins, and every
 * destructive action is confirmed via ConfirmDialog before it is sent.
 */
export default function AdminUsersPage() {
  const { user } = useAuth();
  const isSuperAdmin = user ? SUPER_ADMIN_ROLES.includes(user.role) : false;
  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;

  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Which per-row dialog (if any) is open, and for whom.
  const [banTarget, setBanTarget] = useState<AdminUser | null>(null);
  const [editTarget, setEditTarget] = useState<AdminUser | null>(null);
  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [subTarget, setSubTarget] = useState<AdminUser | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  /** Runs a mutating action, surfacing ApiClientError messages inline. */
  const guard = useCallback(async (label: string, fn: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(label);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
    }
  }, []);

  const loadUsers = useCallback(async (q: string, cursor?: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.users(q || undefined, cursor);
      setUsers((prev) => (cursor ? [...prev, ...res.users] : res.users));
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers('');
  }, [loadUsers]);

  const search = () => {
    setActiveQuery(query.trim());
    void loadUsers(query.trim());
  };

  const refresh = useCallback(() => {
    void loadUsers(activeQuery);
  }, [loadUsers, activeQuery]);

  // --- Status actions ---
  const setStatus = (
    target: AdminUser,
    status: 'active' | 'suspended' | 'banned',
    reason?: string,
  ) =>
    guard('User status updated.', async () => {
      await adminApi.setUserStatus(target.id, {
        status,
        ...(status === 'suspended' ? { durationHours: 24 } : {}),
        ...(reason ? { reason } : {}),
      });
      refresh();
    });

  const columns: DataTableColumn<AdminUser>[] = [
    {
      label: 'User',
      render: (u) => (
        <div className="flex flex-col">
          <span className="text-body text-foreground">{u.name}</span>
          <span className="break-all text-small text-muted-foreground">{u.email}</span>
        </div>
      ),
    },
    {
      label: 'Role',
      render: (u) => <Badge variant="neutral">{u.role.replace(/_/g, ' ')}</Badge>,
    },
    {
      label: 'Status',
      render: (u) => (
        <Badge variant={statusVariant(u.accountStatus)}>{u.accountStatus.replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      label: 'Subscription',
      render: (u) => (
        <Badge variant={u.subscriptionStatus === 'premium' ? 'brand' : 'neutral'}>
          {u.subscriptionStatus}
        </Badge>
      ),
    },
    {
      label: 'Actions',
      className: 'text-right',
      render: (u) => (
        <div className="flex flex-wrap justify-end gap-space-1">
          {u.accountStatus === 'active' ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void setStatus(u, 'suspended')}
                aria-label={`Suspend ${u.name} for 24 hours`}
              >
                Suspend 24h
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setBanTarget(u)}
                aria-label={`Ban ${u.name}`}
              >
                <Ban className="h-4 w-4" aria-hidden="true" />
                Ban
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void setStatus(u, 'active')}
              aria-label={`Restore ${u.name}`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Restore
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setEditTarget(u)}
            aria-label={`Edit ${u.name}`}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSubTarget(u)}
            aria-label={`Manage subscription for ${u.name}`}
          >
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Subscription
          </Button>
          {isSuperAdmin ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRoleTarget(u)}
                aria-label={`Change role for ${u.name}`}
              >
                <ShieldAlert className="h-4 w-4" aria-hidden="true" />
                Role
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => setDeleteTarget(u)}
                aria-label={`Delete ${u.name}`}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Delete
              </Button>
            </>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-space-5">
      <div className="flex flex-wrap items-start justify-between gap-space-3">
        <div className="flex flex-col gap-space-1">
          <h1 className="text-h1 text-foreground">Users</h1>
          <p className="text-body text-muted-foreground">
            Search accounts, manage their lifecycle, and control subscriptions.
          </p>
        </div>
        {isAdmin ? (
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add user
          </Button>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="rounded-card border border-danger/40 bg-danger/10 px-space-4 py-space-3 text-body text-danger"
        >
          {error}
        </div>
      ) : null}
      {notice ? (
        <div
          role="status"
          className="rounded-card border border-success/40 bg-success/10 px-space-4 py-space-3 text-body text-success"
        >
          {notice}
        </div>
      ) : null}

      <div className="flex gap-space-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') search();
          }}
          placeholder="Search by name or email"
          aria-label="Search users by name or email"
        />
        <Button onClick={search} disabled={loading}>
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
        </Button>
      </div>

      <DataTable
        columns={columns}
        rows={users}
        rowKey={(u) => u.id}
        hasMore={Boolean(nextCursor)}
        onLoadMore={() => nextCursor && void loadUsers(activeQuery, nextCursor)}
        loading={loading}
        emptyState="No users match your search."
      />

      {/* --- Ban confirmation (destructive, Req 12.1) --- */}
      <ConfirmDialog
        open={banTarget !== null}
        onClose={() => setBanTarget(null)}
        onConfirm={(reason) => {
          if (banTarget) void setStatus(banTarget, 'banned', reason);
        }}
        title="Ban user"
        description={`Ban ${banTarget?.name ?? 'this user'} (${banTarget?.email ?? ''}). They will be signed out and blocked from signing in.`}
        reversibility="A ban can be lifted later by restoring the account."
        requireReason
        reasonLabel="Reason for ban"
        confirmLabel="Ban user"
      />

      {/* --- Role change (super admin only, confirmed) --- */}
      {roleTarget ? (
        <ChangeRoleDialog
          target={roleTarget}
          onClose={() => setRoleTarget(null)}
          onSubmit={(role, reason) =>
            guard('Role updated.', async () => {
              await adminApi.changeUserRole(roleTarget.id, { role, reason });
              refresh();
              setRoleTarget(null);
            })
          }
        />
      ) : null}

      {/* --- Soft delete (super admin only, requires reason, Req 5.7) --- */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={(reason) => {
          if (deleteTarget)
            void guard('User deleted.', async () => {
              await adminApi.deleteUser(deleteTarget.id, { confirm: true, reason });
              refresh();
            });
        }}
        title="Delete user"
        description={`Soft-delete ${deleteTarget?.name ?? 'this user'}. Their session ends and their data is scheduled for purge.`}
        reversibility="This is a soft delete; recovery requires engineering intervention within the retention window."
        requireReason
        reasonLabel="Reason for deletion"
        confirmLabel="Delete user"
      />

      {/* --- Edit profile fields (Req 5.3) --- */}
      {editTarget ? (
        <EditUserDialog
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            refresh();
            setEditTarget(null);
          }}
          runGuarded={guard}
        />
      ) : null}

      {/* --- Subscription panel (Req 6) --- */}
      {subTarget ? (
        <SubscriptionDialog
          target={subTarget}
          onClose={() => setSubTarget(null)}
          onChanged={refresh}
          runGuarded={guard}
        />
      ) : null}

      {/* --- Manual user creation (Req 4) --- */}
      {showCreate ? (
        <CreateUserDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            refresh();
            setShowCreate(false);
          }}
          runGuarded={guard}
        />
      ) : null}
    </div>
  );
}

/** Signature of the inline error-guarded action runner passed to sub-dialogs. */
type GuardedRunner = (label: string, fn: () => Promise<void>) => Promise<void>;

/**
 * ChangeRoleDialog — super-admin role change. Requires selecting a role and a
 * non-empty reason (ChangeRoleSchema, Req 5.5). Framed as a confirmation of a
 * sensitive change.
 */
function ChangeRoleDialog({
  target,
  onClose,
  onSubmit,
}: {
  target: AdminUser;
  onClose: () => void;
  onSubmit: (role: UserRole, reason: string) => void;
}) {
  const [role, setRole] = useState<UserRole>(target.role);
  const [reason, setReason] = useState('');
  const reasonMissing = reason.trim().length === 0;
  const unchanged = role === target.role;

  return (
    <Dialog open onClose={onClose} title="Change role">
      <div className="space-y-space-4">
        <div className="space-y-space-1">
          <p className="text-body text-foreground">
            Change the role for {target.name} ({target.email}).
          </p>
          <p className="text-caption text-muted-foreground">
            Role changes take effect immediately and are audit-logged.
          </p>
        </div>

        <div className="space-y-space-1">
          <label htmlFor="role-select" className="block text-caption font-medium text-foreground">
            New role
          </label>
          <Select
            id="role-select"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            {USER_ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-space-1">
          <label htmlFor="role-reason" className="block text-caption font-medium text-foreground">
            Reason
          </label>
          <Textarea
            id="role-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-required="true"
            aria-invalid={reasonMissing}
            placeholder="Explain why this role change is being made"
          />
        </div>

        <div className="flex justify-end gap-space-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={reasonMissing || unchanged}
            className={cn((reasonMissing || unchanged) && 'pointer-events-none')}
            onClick={() => onSubmit(role, reason.trim())}
          >
            Change role
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** EditUserDialog — edit permitted profile fields (name / bio / avatar). */
function EditUserDialog({
  target,
  onClose,
  onSaved,
  runGuarded,
}: {
  target: AdminUser;
  onClose: () => void;
  onSaved: () => void;
  runGuarded: GuardedRunner;
}) {
  const [name, setName] = useState(target.name);
  const [bio, setBio] = useState('');
  const [avatarMediaId, setAvatarMediaId] = useState('');

  const save = () =>
    runGuarded('User profile updated.', async () => {
      const trimmedName = name.trim();
      const trimmedBio = bio.trim();
      const trimmedAvatar = avatarMediaId.trim();
      await adminApi.editUser(target.id, {
        ...(trimmedName && trimmedName !== target.name ? { name: trimmedName } : {}),
        ...(trimmedBio ? { bio: trimmedBio } : {}),
        ...(trimmedAvatar ? { avatarMediaId: trimmedAvatar } : {}),
      });
      onSaved();
    });

  return (
    <Dialog open onClose={onClose} title="Edit user">
      <div className="space-y-space-4">
        <div className="space-y-space-1">
          <label htmlFor="edit-name" className="block text-caption font-medium text-foreground">
            Name
          </label>
          <Input
            id="edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-space-1">
          <label htmlFor="edit-bio" className="block text-caption font-medium text-foreground">
            Bio
          </label>
          <Textarea
            id="edit-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={500}
            placeholder="Short profile bio"
          />
        </div>
        <div className="space-y-space-1">
          <label htmlFor="edit-avatar" className="block text-caption font-medium text-foreground">
            Avatar media ID
          </label>
          <Input
            id="edit-avatar"
            value={avatarMediaId}
            onChange={(e) => setAvatarMediaId(e.target.value)}
            placeholder="Optional media UUID"
          />
          <p className="text-caption text-muted-foreground">
            Verified fields (university, branch, year) can&apos;t be edited here.
          </p>
        </div>
        <div className="flex justify-end gap-space-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()}>Save changes</Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * CreateUserDialog — manual account creation (Req 4). Produces a
 * pending_verification account that must still complete Google verification.
 */
function CreateUserDialog({
  onClose,
  onCreated,
  runGuarded,
}: {
  onClose: () => void;
  onCreated: () => void;
  runGuarded: GuardedRunner;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [universityId, setUniversityId] = useState('');
  const [universities, setUniversities] = useState<UniversityOption[]>([]);
  const [password, setPassword] = useState('');

  useEffect(() => {
    void adminApi.universities().then((list) => {
      setUniversities(list);
      setUniversityId((prev) => prev || list[0]?.id || '');
    });
  }, []);

  const canSubmit =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    universityId.trim().length > 0 &&
    password.length >= 8;

  const create = () =>
    runGuarded('User created — active, can sign in with email + password.', async () => {
      await adminApi.createUser({
        name: name.trim(),
        email: email.trim(),
        universityId: universityId.trim(),
        password,
      });
      onCreated();
    });

  return (
    <Dialog open onClose={onClose} title="Add user">
      <div className="space-y-space-4">
        <div className="space-y-space-1">
          <label htmlFor="create-name" className="block text-caption font-medium text-foreground">
            Name
          </label>
          <Input
            id="create-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={120}
          />
        </div>
        <div className="space-y-space-1">
          <label htmlFor="create-email" className="block text-caption font-medium text-foreground">
            Email
          </label>
          <Input
            id="create-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="student@university.edu"
          />
        </div>
        <div className="space-y-space-1">
          <label
            htmlFor="create-university"
            className="block text-caption font-medium text-foreground"
          >
            University
          </label>
          <Select
            id="create-university"
            value={universityId}
            onChange={(e) => setUniversityId(e.target.value)}
          >
            {universities.length === 0 ? <option value="">Loading campuses…</option> : null}
            {universities.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.shortName ? ` (${u.shortName})` : ''}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-space-1">
          <label
            htmlFor="create-password"
            className="block text-caption font-medium text-foreground"
          >
            Password
          </label>
          <Input
            id="create-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
          />
        </div>
        <p className="rounded-card bg-muted px-space-3 py-space-2 text-caption text-muted-foreground">
          The account is created active. The user can sign in immediately with this email and
          password — no Google verification required.
        </p>
        <div className="flex justify-end gap-space-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void create()}
            disabled={!canSubmit}
            className={cn(!canSubmit && 'pointer-events-none')}
          >
            Create user
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Converts a datetime-local input value to an ISO-8601 string (or null). */
function toIso(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * SubscriptionDialog — per-user subscription control (Req 6). Shows the current
 * state and offers grant / change / revoke. Revoke is confirmed since it
 * downgrades the user to free.
 */
function SubscriptionDialog({
  target,
  onClose,
  onChanged,
  runGuarded,
}: {
  target: AdminUser;
  onClose: () => void;
  onChanged: () => void;
  runGuarded: GuardedRunner;
}) {
  const [sub, setSub] = useState<UserSubscriptionState | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [planId, setPlanId] = useState('');
  const [expiry, setExpiry] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLocalError(null);
    try {
      const [subRes, planRes] = await Promise.all([
        adminApi.getSubscription(target.id),
        adminApi.subscriptionPlans(),
      ]);
      setSub(subRes.subscription);
      setPlans(planRes.plans);
      setPlanId(subRes.subscription.plan?.id ?? planRes.plans[0]?.id ?? '');
    } catch (err) {
      setLocalError(err instanceof ApiClientError ? err.message : 'Failed to load subscription.');
    } finally {
      setLoading(false);
    }
  }, [target.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const hasActiveSub = sub?.status === 'active' || sub?.status === 'granted';

  const grant = () =>
    runGuarded('Subscription granted.', async () => {
      const iso = toIso(expiry);
      if (!planId || !iso) {
        setLocalError('Select a plan and an expiry date.');
        return;
      }
      await adminApi.grantSubscription(target.id, { planId, currentPeriodEnd: iso });
      await load();
      onChanged();
    });

  const change = () =>
    runGuarded('Subscription updated.', async () => {
      const iso = toIso(expiry);
      if (!planId && !iso) {
        setLocalError('Change the plan or the expiry date.');
        return;
      }
      await adminApi.changeSubscription(target.id, {
        ...(planId ? { planId } : {}),
        ...(iso ? { currentPeriodEnd: iso } : {}),
      });
      await load();
      onChanged();
    });

  const revoke = (reason: string) =>
    runGuarded('Subscription revoked.', async () => {
      await adminApi.revokeSubscription(target.id, reason ? { reason } : {});
      setConfirmRevoke(false);
      await load();
      onChanged();
    });

  return (
    <>
      <Dialog open onClose={onClose} title="Subscription">
        <div className="space-y-space-4">
          <p className="text-body text-foreground">
            {target.name} <span className="text-muted-foreground">({target.email})</span>
          </p>

          {localError ? (
            <div
              role="alert"
              className="rounded-card border border-danger/40 bg-danger/10 px-space-3 py-space-2 text-caption text-danger"
            >
              {localError}
            </div>
          ) : null}

          {loading ? (
            <p className="text-caption text-muted-foreground">Loading subscription…</p>
          ) : (
            <>
              <Card className="space-y-space-1 p-space-4">
                <CardTitle className="text-h3">Current</CardTitle>
                <CardDescription>
                  {sub && sub.plan
                    ? `${sub.plan.name} · ${sub.status ?? 'unknown'} · ${sub.source ?? 'unknown'}`
                    : 'No active subscription (free tier).'}
                </CardDescription>
                {sub?.currentPeriodEnd ? (
                  <p className="text-caption text-muted-foreground">
                    Expires {new Date(sub.currentPeriodEnd).toLocaleString()}
                  </p>
                ) : null}
                <div>
                  <Badge variant={sub?.cachedStatus === 'premium' ? 'brand' : 'neutral'}>
                    {sub?.cachedStatus ?? 'free'}
                  </Badge>
                </div>
              </Card>

              <div className="space-y-space-2">
                <div className="space-y-space-1">
                  <label
                    htmlFor="sub-plan"
                    className="block text-caption font-medium text-foreground"
                  >
                    Plan
                  </label>
                  <Select id="sub-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
                    {plans.length === 0 ? <option value="">No plans available</option> : null}
                    {plans.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.isActive}>
                        {p.name} ({p.interval}){p.isActive ? '' : ' — inactive'}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-space-1">
                  <label
                    htmlFor="sub-expiry"
                    className="block text-caption font-medium text-foreground"
                  >
                    Expiry
                  </label>
                  <Input
                    id="sub-expiry"
                    type="datetime-local"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-space-2">
                {hasActiveSub ? (
                  <>
                    <Button variant="danger" onClick={() => setConfirmRevoke(true)}>
                      Revoke
                    </Button>
                    <Button variant="secondary" onClick={() => void change()}>
                      Change
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => void grant()}>Grant</Button>
                )}
              </div>
            </>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={(reason) => void revoke(reason)}
        title="Revoke subscription"
        description={`Revoke ${target.name}'s subscription. They will be downgraded to the free tier.`}
        reversibility="You can grant a new subscription afterwards if needed."
        requireReason
        reasonLabel="Reason for revoking"
        confirmLabel="Revoke"
      />
    </>
  );
}
