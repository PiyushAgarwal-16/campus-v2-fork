'use client';

import { useEffect, useState } from 'react';
import { CreditCard, Search } from 'lucide-react';
import type { SubscriptionPlan, UserSubscriptionState } from '@campusly/shared-types';
import { adminApi } from '../../../lib/admin';
import { DataTable, type DataTableColumn } from '../../../components/admin/DataTable';
import { ConfirmDialog } from '../../../components/admin/ConfirmDialog';
import { Card, CardDescription } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';

/**
 * Subscriptions page (Req 6.1). Rendered inside the guarded `/admin` layout, so
 * it renders neither the student `AppNav` nor its own auth redirect — the layout
 * enforces access and `AdminShell` provides the chrome.
 *
 * This surface is read-oriented: it shows the plan catalog and lets an operator
 * look up a single user's subscription state. Full grant/revoke/change
 * management lives on the Users page; a convenience revoke is offered here
 * behind a confirmation.
 */
export default function AdminSubscriptionsPage() {
  return (
    <div className="flex flex-col gap-space-6">
      <div className="flex flex-col gap-space-1">
        <h1 className="text-h1 text-foreground">Subscriptions</h1>
        <p className="text-body text-muted-foreground">
          Review the plan catalog and look up a user&apos;s subscription state.
        </p>
      </div>

      <PlanCatalogSection />
      <UserLookupSection />
    </div>
  );
}

/** Formats an integer cents amount as a currency string (e.g. 49900 → "$499.00"). */
function formatPrice(priceCents: number, currency: string): string {
  const amount = (priceCents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency} ${amount}`;
}

function PlanCatalogSection() {
  const [plans, setPlans] = useState<SubscriptionPlan[] | null>(null);

  useEffect(() => {
    void adminApi.subscriptionPlans().then((res) => setPlans(res.plans));
  }, []);

  const columns: DataTableColumn<SubscriptionPlan>[] = [
    { label: 'Code', render: (p) => <span className="font-medium text-foreground">{p.code}</span> },
    { label: 'Name', render: (p) => p.name },
    { label: 'Price', render: (p) => formatPrice(p.priceCents, p.currency) },
    { label: 'Interval', render: (p) => p.interval },
    {
      label: 'Status',
      render: (p) => (
        <Badge variant={p.isActive ? 'success' : 'neutral'}>
          {p.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  return (
    <section aria-label="Plan catalog" className="flex flex-col gap-space-3">
      <div className="flex items-center gap-space-2">
        <CreditCard className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-h3 text-foreground">Plan catalog</h2>
      </div>
      <DataTable
        columns={columns}
        rows={plans ?? []}
        rowKey={(p) => p.id}
        loading={plans === null}
        emptyState="No subscription plans configured."
      />
    </section>
  );
}

function UserLookupSection() {
  const [userId, setUserId] = useState('');
  const [subscription, setSubscription] = useState<UserSubscriptionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const canLookup = userId.trim().length > 0 && !loading;

  const lookup = async () => {
    const id = userId.trim();
    if (id.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getSubscription(id);
      setSubscription(res.subscription);
    } catch {
      setSubscription(null);
      setError('Could not load a subscription for that user id.');
    } finally {
      setLoading(false);
    }
  };

  const revoke = async (reason: string) => {
    if (!subscription) return;
    await adminApi.revokeSubscription(subscription.userId, reason ? { reason } : {});
    await lookup();
  };

  const hasActiveSub =
    subscription !== null &&
    (subscription.status === 'active' || subscription.status === 'granted');

  return (
    <section aria-label="User subscription lookup" className="flex flex-col gap-space-3">
      <div className="flex items-center gap-space-2">
        <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-h3 text-foreground">Look up a user&apos;s subscription</h2>
      </div>

      <Card className="flex flex-col gap-space-3">
        <div className="flex flex-col gap-space-2 sm:flex-row">
          <label htmlFor="subscription-user-id" className="sr-only">
            User id
          </label>
          <Input
            id="subscription-user-id"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void lookup();
            }}
            placeholder="User id (UUID)"
          />
          <Button className="sm:w-auto" onClick={() => void lookup()} disabled={!canLookup}>
            Look up
          </Button>
        </div>

        {error ? <p className="text-caption text-danger">{error}</p> : null}

        {subscription ? (
          <div className="flex flex-col gap-space-2 rounded-card border border-border p-space-4">
            <dl className="grid grid-cols-1 gap-space-3 sm:grid-cols-2">
              <Field label="Plan" value={subscription.plan ? subscription.plan.name : '—'} />
              <Field label="Status" value={subscription.status ?? '—'} />
              <Field label="Source" value={subscription.source ?? '—'} />
              <Field
                label="Current period end"
                value={
                  subscription.currentPeriodEnd
                    ? new Date(subscription.currentPeriodEnd).toLocaleString()
                    : '—'
                }
              />
              <div className="flex flex-col gap-space-1">
                <dt className="text-caption text-muted-foreground">Cached status</dt>
                <dd>
                  <Badge variant={subscription.cachedStatus === 'premium' ? 'brand' : 'neutral'}>
                    {subscription.cachedStatus}
                  </Badge>
                </dd>
              </div>
            </dl>

            {hasActiveSub ? (
              <div className="flex justify-end">
                <Button variant="danger" size="sm" onClick={() => setConfirmRevoke(true)}>
                  Revoke subscription
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <CardDescription>
          Grant, change, and revoke a subscription for a specific user from the Users page. This
          lookup is read-oriented.
        </CardDescription>
      </Card>

      <ConfirmDialog
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={(reason) => void revoke(reason)}
        title="Revoke subscription"
        description={`Revoke the active subscription for user ${subscription?.userId ?? ''}.`}
        reversibility="The user is downgraded to free immediately. You can grant a new subscription afterward."
        requireReason
        confirmLabel="Revoke"
      />
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-space-1">
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className="text-body text-foreground">{value}</dd>
    </div>
  );
}
