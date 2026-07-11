import { z } from 'zod';
import type { SubscriptionStatus } from './auth.js';

/**
 * Subscription contracts (ADMIN_PANEL.md §8, DATABASE_SCHEMA.md §17). The
 * authoritative subscription state lives in `user_subscriptions`; the
 * denormalized `users.subscription_status` cache (`SubscriptionStatus`) is a
 * pure derivative of that state kept in sync by the Subscription_Service.
 */

/** Billing cadence of a plan (`subscription_plans.interval`). */
export const SUBSCRIPTION_PLAN_INTERVALS = ['none', 'monthly', 'yearly'] as const;
export type SubscriptionPlanInterval = (typeof SUBSCRIPTION_PLAN_INTERVALS)[number];

/** Authoritative state of a user's subscription (`user_subscriptions.status`). */
export const USER_SUBSCRIPTION_STATUSES = ['active', 'cancelled', 'expired', 'granted'] as const;
export type UserSubscriptionStatus = (typeof USER_SUBSCRIPTION_STATUSES)[number];

/** How a subscription came to exist (`user_subscriptions.source`). */
export const SUBSCRIPTION_SOURCES = ['purchase', 'admin_grant', 'trial'] as const;
export type SubscriptionSource = (typeof SUBSCRIPTION_SOURCES)[number];

// --- DTOs ---

/** A purchasable/grantable plan (`subscription_plans`). */
export interface SubscriptionPlan {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  currency: string;
  interval: SubscriptionPlanInterval;
  isActive: boolean;
}

/**
 * A user's current subscription as surfaced to admins. `cachedStatus` is the
 * denormalized `users.subscription_status` value derived from authoritative
 * state; the other fields describe the live `user_subscriptions` row (null
 * when the user has no subscription).
 */
export interface UserSubscriptionState {
  userId: string;
  plan: SubscriptionPlan | null;
  status: UserSubscriptionStatus | null;
  source: SubscriptionSource | null;
  currentPeriodEnd: string | null;
  cachedStatus: SubscriptionStatus;
}

// --- Request schemas ---

/** Grant a comp subscription to a user (source = admin_grant). */
export const GrantSubscriptionSchema = z.object({
  planId: z.string().uuid(),
  currentPeriodEnd: z.string().datetime(),
  reason: z.string().trim().max(1000).optional(),
});
export type GrantSubscriptionInput = z.infer<typeof GrantSubscriptionSchema>;

/** Change a user's plan and/or expiry; at least one must be provided. */
export const ChangeSubscriptionSchema = z
  .object({
    planId: z.string().uuid().optional(),
    currentPeriodEnd: z.string().datetime().optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((v) => Boolean(v.planId) || Boolean(v.currentPeriodEnd), {
    message: 'Provide planId or currentPeriodEnd',
  });
export type ChangeSubscriptionInput = z.infer<typeof ChangeSubscriptionSchema>;

/** Revoke a user's active subscription (downgrades to free). */
export const RevokeSubscriptionSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
});
export type RevokeSubscriptionInput = z.infer<typeof RevokeSubscriptionSchema>;
