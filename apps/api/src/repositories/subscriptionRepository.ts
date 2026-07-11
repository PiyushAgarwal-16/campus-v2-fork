import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import type { SubscriptionStatus } from '@campusly/shared-types';
import { db } from '../db/client.js';
import {
  subscriptionPlans,
  userSubscriptions,
  auditLogs,
  users,
  type SubscriptionPlanRow,
  type UserSubscriptionRow,
} from '../db/schema.js';

/**
 * Data access for subscriptions (DATABASE_SCHEMA.md §17). Reads expose the
 * plan catalog and a user's authoritative `user_subscriptions` state; every
 * mutation writes the authoritative row, syncs the denormalized
 * `users.subscription_status` cache, and appends its `audit_logs` entry inside
 * a single `db.transaction` (Admin Control Center design, Requirement 13.1).
 *
 * Business validation (unknown/inactive plan, past expiry) and the pure
 * cache-derivation function live in `subscriptionService`; this layer accepts
 * the already-resolved `subscription_status` value so the cache write happens
 * in the same transaction as the mutation.
 */

/** A user's authoritative subscription row joined to its plan. */
export interface UserSubscriptionWithPlan {
  subscription: UserSubscriptionRow;
  plan: SubscriptionPlanRow;
}

export const subscriptionRepository = {
  // --- Plan lookups ---
  async listActivePlans(): Promise<SubscriptionPlanRow[]> {
    return db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true))
      .orderBy(subscriptionPlans.code);
  },

  async findPlanById(planId: string): Promise<SubscriptionPlanRow | null> {
    const rows = await db
      .select()
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.id, planId))
      .limit(1);
    return rows[0] ?? null;
  },

  // --- User subscription reads ---
  /**
   * Returns the user's most recent authoritative `user_subscriptions` row
   * joined to its plan, or null when the user has no subscription rows. The
   * service maps this to `UserSubscriptionState`.
   */
  async getStateForUser(userId: string): Promise<UserSubscriptionWithPlan | null> {
    const rows = await db
      .select({ subscription: userSubscriptions, plan: subscriptionPlans })
      .from(userSubscriptions)
      .innerJoin(subscriptionPlans, eq(userSubscriptions.planId, subscriptionPlans.id))
      .where(eq(userSubscriptions.userId, userId))
      .orderBy(desc(userSubscriptions.startedAt), desc(userSubscriptions.createdAt))
      .limit(1);
    return rows[0] ?? null;
  },

  // --- Transactional mutations (mutation + audit_logs in one transaction) ---
  /**
   * Creates an `admin_grant` subscription row (`status='granted'`) with the
   * given expiry, syncs the users cache to the resolved status, and writes a
   * `subscription.grant` audit entry.
   */
  async insertGranted(input: {
    actorId: string;
    userId: string;
    planId: string;
    currentPeriodEnd: Date;
    cachedStatus: SubscriptionStatus;
    reason?: string | null;
  }): Promise<UserSubscriptionRow> {
    return db.transaction(async (tx) => {
      const [subscription] = await tx
        .insert(userSubscriptions)
        .values({
          userId: input.userId,
          planId: input.planId,
          status: 'granted',
          source: 'admin_grant',
          currentPeriodEnd: input.currentPeriodEnd,
        })
        .returning();
      if (!subscription) throw new Error('Failed to create subscription');

      await tx
        .update(users)
        .set({ subscriptionStatus: input.cachedStatus, updatedAt: new Date() })
        .where(eq(users.id, input.userId));

      await tx.insert(auditLogs).values({
        actorId: input.actorId,
        action: 'subscription.grant',
        targetType: 'user',
        targetId: input.userId,
        metadata: {
          reason: input.reason ?? null,
          planId: input.planId,
          subscriptionId: subscription.id,
          currentPeriodEnd: input.currentPeriodEnd.toISOString(),
        },
      });
      return subscription;
    });
  },

  /**
   * Sets the given active/granted subscription to `status='cancelled'` with
   * `cancelledAt=now`, syncs the users cache, and writes a
   * `subscription.revoke` audit entry.
   */
  async markCancelled(input: {
    actorId: string;
    userId: string;
    subscriptionId: string;
    cachedStatus: SubscriptionStatus;
    reason?: string | null;
  }): Promise<UserSubscriptionRow> {
    return db.transaction(async (tx) => {
      const now = new Date();
      const [subscription] = await tx
        .update(userSubscriptions)
        .set({ status: 'cancelled', cancelledAt: now })
        .where(eq(userSubscriptions.id, input.subscriptionId))
        .returning();
      if (!subscription) throw new Error('Failed to cancel subscription');

      await tx
        .update(users)
        .set({ subscriptionStatus: input.cachedStatus, updatedAt: now })
        .where(eq(users.id, input.userId));

      await tx.insert(auditLogs).values({
        actorId: input.actorId,
        action: 'subscription.revoke',
        targetType: 'user',
        targetId: input.userId,
        metadata: {
          reason: input.reason ?? null,
          subscriptionId: subscription.id,
        },
      });
      return subscription;
    });
  },

  /**
   * Updates `planId` and/or `currentPeriodEnd` on the authoritative row, syncs
   * the users cache, and writes a `subscription.change` audit entry.
   */
  async patchSubscription(input: {
    actorId: string;
    userId: string;
    subscriptionId: string;
    planId?: string;
    currentPeriodEnd?: Date;
    cachedStatus: SubscriptionStatus;
    reason?: string | null;
  }): Promise<UserSubscriptionRow> {
    return db.transaction(async (tx) => {
      const patch: Partial<Pick<UserSubscriptionRow, 'planId' | 'currentPeriodEnd'>> = {};
      if (input.planId !== undefined) patch.planId = input.planId;
      if (input.currentPeriodEnd !== undefined) patch.currentPeriodEnd = input.currentPeriodEnd;

      const [subscription] = await tx
        .update(userSubscriptions)
        .set(patch)
        .where(eq(userSubscriptions.id, input.subscriptionId))
        .returning();
      if (!subscription) throw new Error('Failed to update subscription');

      await tx
        .update(users)
        .set({ subscriptionStatus: input.cachedStatus, updatedAt: new Date() })
        .where(eq(users.id, input.userId));

      await tx.insert(auditLogs).values({
        actorId: input.actorId,
        action: 'subscription.change',
        targetType: 'user',
        targetId: input.userId,
        metadata: {
          reason: input.reason ?? null,
          subscriptionId: subscription.id,
          planId: input.planId ?? null,
          currentPeriodEnd: input.currentPeriodEnd ? input.currentPeriodEnd.toISOString() : null,
        },
      });
      return subscription;
    });
  },

  // --- Expiry sweep ---
  /**
   * Sets an expired active/granted subscription to `status='expired'`, syncs the
   * denormalized users cache to the resolved status, and writes a system
   * `subscription.auto_expire` audit entry with a null actor (Req 6.7, 13.3).
   */
  async markExpired(input: {
    userId: string;
    subscriptionId: string;
    cachedStatus: SubscriptionStatus;
  }): Promise<UserSubscriptionRow> {
    return db.transaction(async (tx) => {
      const now = new Date();
      const [subscription] = await tx
        .update(userSubscriptions)
        .set({ status: 'expired' })
        .where(eq(userSubscriptions.id, input.subscriptionId))
        .returning();
      if (!subscription) throw new Error('Failed to expire subscription');

      await tx
        .update(users)
        .set({ subscriptionStatus: input.cachedStatus, updatedAt: now })
        .where(eq(users.id, input.userId));

      await tx.insert(auditLogs).values({
        actorId: null,
        action: 'subscription.auto_expire',
        targetType: 'user',
        targetId: input.userId,
        metadata: { subscriptionId: subscription.id },
      });
      return subscription;
    });
  },

  /**
   * Rows still marked `active`/`granted` whose `current_period_end` has passed
   * (null expiry never expires). Consumed by the Subscription_Service expiry
   * sweep (Requirement 6.7).
   */
  async findExpiredActive(now: Date): Promise<UserSubscriptionRow[]> {
    return db
      .select()
      .from(userSubscriptions)
      .where(
        and(
          inArray(userSubscriptions.status, ['active', 'granted']),
          lt(userSubscriptions.currentPeriodEnd, now),
        ),
      );
  },
};
