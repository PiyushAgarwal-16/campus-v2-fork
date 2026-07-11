import type { SubscriptionPlanInterval } from '@campusly/shared-types';

/**
 * Base subscription-plan reference data (DATABASE_SCHEMA.md §17.1).
 *
 * These rows populate the `subscription_plans` table, the catalog of
 * purchasable/grantable plans. They exist so Admin Control Center grant flows
 * always have a target plan to reference (`source='admin_grant'`,
 * `status='granted'`) — aligns with FEATURE_MATRIX.md §14 and the Admin
 * Control Center design ("Migration seeds").
 *
 * `code` is the stable, unique business key used for lookups and upserts, so
 * the seed is idempotent: re-running inserts new plans and refreshes the
 * metadata of existing ones without creating duplicates (upsert by `code`).
 *
 * `priceCents` is stored in the smallest currency unit (paise for INR). The
 * `free` plan is priced at 0 with `interval='none'`; recurring paid plans use
 * `interval='monthly'`/`'yearly'`.
 */
export interface SubscriptionPlanSeed {
  code: string;
  name: string;
  priceCents: number;
  currency: string;
  interval: SubscriptionPlanInterval;
  isActive: boolean;
}

export const SUBSCRIPTION_PLAN_SEED: SubscriptionPlanSeed[] = [
  {
    code: 'free',
    name: 'Free',
    priceCents: 0,
    currency: 'INR',
    interval: 'none',
    isActive: true,
  },
  {
    code: 'premium_monthly',
    name: 'Premium (Monthly)',
    priceCents: 9900,
    currency: 'INR',
    interval: 'monthly',
    isActive: true,
  },
];
