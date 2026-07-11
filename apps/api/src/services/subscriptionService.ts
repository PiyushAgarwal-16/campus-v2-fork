import type {
  AccessTokenClaims,
  ChangeSubscriptionInput,
  GrantSubscriptionInput,
  RevokeSubscriptionInput,
  SubscriptionPlan,
  SubscriptionStatus,
  UserSubscriptionState,
} from '@campusly/shared-types';
import type { SubscriptionPlanRow, UserSubscriptionRow } from '../db/schema.js';
import { NotFoundError, ValidationError } from '../domain/errors.js';
import { userRepository } from '../repositories/userRepository.js';
import {
  subscriptionRepository,
  type UserSubscriptionWithPlan,
} from '../repositories/subscriptionRepository.js';
import { logger } from '../config/logger.js';

/** Expiry-sweep cadence; mirrors the ban sweeper interval (adminService). */
const SWEEP_INTERVAL_MS = 60_000;

/** Handle for the running expiry sweep, or null when stopped. Module-scoped so
 * `start`/`stop` are idempotent across the singleton service object. */
let expirySweeper: ReturnType<typeof setInterval> | null = null;

/**
 * Subscription_Service (ADMIN_PANEL.md §8, DATABASE_SCHEMA.md §17).
 *
 * The authoritative subscription state lives in `user_subscriptions`; the
 * denormalized `users.subscription_status` cache is a pure derivative of that
 * state. `deriveSubscriptionStatus` below is the single source of that mapping
 * and is reused by the service mutations (grant/revoke/change) and the expiry
 * sweep so the cache never diverges from authoritative state (Design
 * "Authoritative-state → cache derivation", Correctness Property 1).
 *
 * Grant/revoke/change mutations and the expiry sweep are added to this file by
 * tasks 4.3 and 4.4. Follows the service conventions used elsewhere (see
 * `notificationService.ts`): typed against `$inferSelect` row shapes, pure
 * helpers kept free of I/O.
 */

/** Minimal structural view of a subscription row needed to derive the cache. */
type DerivableSubscription = Pick<UserSubscriptionRow, 'status' | 'currentPeriodEnd'>;

/** Statuses that count as entitling a user to `premium` while unexpired. */
const ENTITLING_STATUSES: ReadonlySet<UserSubscriptionRow['status']> = new Set([
  'active',
  'granted',
]);

/**
 * Derive the denormalized `users.subscription_status` cache value from the
 * authoritative set of a user's subscription rows at a point in time.
 *
 * Returns `'premium'` iff there exists a subscription whose status is `active`
 * or `granted` and whose `currentPeriodEnd` is either null (no expiry) or
 * strictly after `now`; otherwise `'free'`. Pure: performs no I/O.
 */
export function deriveSubscriptionStatus(
  subs: readonly DerivableSubscription[],
  now: Date,
): SubscriptionStatus {
  const hasEntitlement = subs.some(
    (sub) =>
      ENTITLING_STATUSES.has(sub.status) &&
      (sub.currentPeriodEnd === null || sub.currentPeriodEnd.getTime() > now.getTime()),
  );
  return hasEntitlement ? 'premium' : 'free';
}

// --- DTO mapping helpers ---

/** Maps a `subscription_plans` row to the public `SubscriptionPlan` DTO. */
function toPlanDto(row: SubscriptionPlanRow): SubscriptionPlan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    priceCents: row.priceCents,
    currency: row.currency,
    interval: row.interval,
    isActive: row.isActive,
  };
}

/**
 * Maps a user's authoritative subscription row (+ plan) and the denormalized
 * `users.subscription_status` cache to the `UserSubscriptionState` DTO. When
 * `state` is null the user has no subscription row, so plan/status/source/
 * expiry are null and only the cache is reported.
 */
function toStateDto(
  userId: string,
  cachedStatus: SubscriptionStatus,
  state: UserSubscriptionWithPlan | null,
): UserSubscriptionState {
  if (!state) {
    return {
      userId,
      plan: null,
      status: null,
      source: null,
      currentPeriodEnd: null,
      cachedStatus,
    };
  }
  return {
    userId,
    plan: toPlanDto(state.plan),
    status: state.subscription.status,
    source: state.subscription.source,
    currentPeriodEnd: state.subscription.currentPeriodEnd?.toISOString() ?? null,
    cachedStatus,
  };
}

/**
 * Reads the user's denormalized `users.subscription_status` cache, throwing
 * `NotFoundError` when the user does not exist. This cache is the authoritative
 * value surfaced as `cachedStatus`.
 */
async function readCachedStatus(userId: string): Promise<SubscriptionStatus> {
  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError('User not found.');
  return user.subscriptionStatus;
}

/**
 * Validates that `iso` (an ISO-8601 datetime) is strictly in the future
 * relative to `now`, throwing `ValidationError` otherwise. Returns the parsed
 * `Date` for reuse by the caller.
 */
function requireFutureDate(iso: string, now: Date): Date {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime()) || date.getTime() <= now.getTime()) {
    throw new ValidationError('currentPeriodEnd must be in the future.');
  }
  return date;
}

/**
 * Resolves an active/granted plan by id, throwing `ValidationError` when the
 * plan is unknown or inactive. Grants and changes must never target an
 * inactive or missing plan (Requirements 6.5).
 */
async function requireActivePlan(planId: string): Promise<SubscriptionPlanRow> {
  const plan = await subscriptionRepository.findPlanById(planId);
  if (!plan || !plan.isActive) {
    throw new ValidationError('Subscription plan not found or inactive.');
  }
  return plan;
}

/** Statuses that represent a live (revocable/changeable) subscription. */
const LIVE_STATUSES: ReadonlySet<UserSubscriptionRow['status']> = new Set(['active', 'granted']);

/**
 * Subscription_Service (ADMIN_PANEL.md §8, DATABASE_SCHEMA.md §17).
 *
 * Read + mutate a user's subscription while keeping the denormalized
 * `users.subscription_status` cache in sync via `deriveSubscriptionStatus`.
 * All data access goes through `subscriptionRepository`; every mutation
 * validates its input (unknown/inactive plan, past expiry) BEFORE any write so
 * rejections have no side effects (Requirements 6.1–6.6). The expiry sweep is
 * added by task 4.4.
 */
export const subscriptionService = {
  /** Current subscription state for a user, including the cache value (Req 6.1). */
  async getForUser(userId: string): Promise<UserSubscriptionState> {
    const [cachedStatus, state] = await Promise.all([
      readCachedStatus(userId),
      subscriptionRepository.getStateForUser(userId),
    ]);
    return toStateDto(userId, cachedStatus, state);
  },

  /** Grant a comp subscription (source=admin_grant, status=granted) (Req 6.2). */
  async grant(
    claims: AccessTokenClaims,
    userId: string,
    input: GrantSubscriptionInput,
  ): Promise<UserSubscriptionState> {
    const now = new Date();
    // Validate BEFORE any write so rejections have no side effects.
    await requireActivePlan(input.planId);
    const currentPeriodEnd = requireFutureDate(input.currentPeriodEnd, now);

    // The resulting set contains the new granted, unexpired subscription.
    const cachedStatus = deriveSubscriptionStatus([{ status: 'granted', currentPeriodEnd }], now);

    await subscriptionRepository.insertGranted({
      actorId: claims.sub,
      userId,
      planId: input.planId,
      currentPeriodEnd,
      cachedStatus,
      reason: input.reason ?? null,
    });
    return this.getForUser(userId);
  },

  /** Revoke a user's live subscription, downgrading the cache (Req 6.3). */
  async revoke(
    claims: AccessTokenClaims,
    userId: string,
    input: RevokeSubscriptionInput,
  ): Promise<void> {
    const now = new Date();
    const state = await subscriptionRepository.getStateForUser(userId);
    if (!state || !LIVE_STATUSES.has(state.subscription.status)) {
      throw new NotFoundError('No active subscription to revoke.');
    }

    // After cancellation the row is no longer entitling → typically 'free'.
    const cachedStatus = deriveSubscriptionStatus(
      [{ status: 'cancelled', currentPeriodEnd: state.subscription.currentPeriodEnd }],
      now,
    );

    await subscriptionRepository.markCancelled({
      actorId: claims.sub,
      userId,
      subscriptionId: state.subscription.id,
      cachedStatus,
      reason: input.reason ?? null,
    });
  },

  /** Change a user's plan and/or expiry, resyncing the cache (Req 6.4). */
  async change(
    claims: AccessTokenClaims,
    userId: string,
    input: ChangeSubscriptionInput,
  ): Promise<UserSubscriptionState> {
    const now = new Date();
    // Validate provided fields BEFORE resolving/writing the authoritative row.
    if (input.planId !== undefined) await requireActivePlan(input.planId);
    const currentPeriodEnd =
      input.currentPeriodEnd !== undefined
        ? requireFutureDate(input.currentPeriodEnd, now)
        : undefined;

    const state = await subscriptionRepository.getStateForUser(userId);
    if (!state) throw new NotFoundError('No subscription to change.');

    // Recompute the cache over the resulting row (status unchanged; new expiry
    // if provided, else the existing one).
    const cachedStatus = deriveSubscriptionStatus(
      [
        {
          status: state.subscription.status,
          currentPeriodEnd: currentPeriodEnd ?? state.subscription.currentPeriodEnd,
        },
      ],
      now,
    );

    await subscriptionRepository.patchSubscription({
      actorId: claims.sub,
      userId,
      subscriptionId: state.subscription.id,
      ...(input.planId !== undefined ? { planId: input.planId } : {}),
      ...(currentPeriodEnd !== undefined ? { currentPeriodEnd } : {}),
      cachedStatus,
      reason: input.reason ?? null,
    });
    return this.getForUser(userId);
  },

  /** Active, grantable plan catalog (Req 6.5). */
  async listPlans(): Promise<SubscriptionPlan[]> {
    const rows = await subscriptionRepository.listActivePlans();
    return rows.map(toPlanDto);
  },

  /**
   * Auto-expire subscriptions whose `currentPeriodEnd` has passed, downgrading
   * the denormalized cache and writing a system `subscription.auto_expire` audit
   * per affected user (Req 6.7). Mirrors `adminService.startBanSweeper`:
   * idempotent, unref'd interval, errors logged (never thrown).
   */
  startExpirySweep(): void {
    if (expirySweeper) return;
    const run = async () => {
      const now = new Date();
      const expired = await subscriptionRepository.findExpiredActive(now);
      for (const sub of expired) {
        // The row is now expired → recompute the cache over the resulting state.
        const cachedStatus = deriveSubscriptionStatus(
          [{ status: 'expired', currentPeriodEnd: sub.currentPeriodEnd }],
          now,
        );
        await subscriptionRepository.markExpired({
          userId: sub.userId,
          subscriptionId: sub.id,
          cachedStatus,
        });
      }
      if (expired.length) logger.info({ expired: expired.length }, 'Auto-expired subscriptions');
    };
    expirySweeper = setInterval(
      () => void run().catch((err) => logger.error({ err }, 'subscription expiry sweep failed')),
      SWEEP_INTERVAL_MS,
    );
    expirySweeper.unref?.();
  },

  /** Stop the expiry sweep (graceful shutdown). Idempotent. */
  stopExpirySweep(): void {
    if (!expirySweeper) return;
    clearInterval(expirySweeper);
    expirySweeper = null;
  },
};
