import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { subscriptionPlans, universities } from './schema.js';
import { SUBSCRIPTION_PLAN_SEED } from './seeds/subscriptionPlans.js';
import { UNIVERSITY_SEED } from './seeds/universities.js';

/**
 * Standalone reference-data seed runner (DATABASE_SCHEMA.md §5.1, §17.1).
 *
 * Populates the `universities` table (recognized campuses) required for Google
 * sign-in eligibility and the `subscription_plans` catalog (base free/premium
 * plans) required as targets for Admin Control Center grant flows. Like the
 * migration runner, this is an EXPLICIT deploy step — run AFTER migrations,
 * never during application boot — and depends only on production packages
 * (`drizzle-orm` + `postgres`), so it runs under a pruned `npm ci --omit=dev`
 * install. It opens its own single-use connection, separate from the app pool
 * in `client.ts`, and closes it when done.
 *
 * Idempotent: universities upsert by the unique `name` constraint and plans
 * upsert by the unique `code` constraint, so re-running inserts new rows and
 * refreshes the metadata of existing ones without creating duplicates.
 */
async function main(): Promise<void> {
  const seedClient = postgres(config.DATABASE_URL, { max: 1 });
  const db = drizzle(seedClient);

  try {
    for (const u of UNIVERSITY_SEED) {
      // Normalize to the bare host the sign-in lookup uses: lowercase, no '@'.
      const emailDomains = u.emailDomains.map((d) => d.trim().toLowerCase().replace(/^@/, ''));
      await db
        .insert(universities)
        .values({
          name: u.name,
          shortName: u.shortName ?? null,
          emailDomains,
          city: u.city ?? null,
          state: u.state ?? null,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: universities.name,
          set: {
            shortName: u.shortName ?? null,
            emailDomains,
            city: u.city ?? null,
            state: u.state ?? null,
            isActive: true,
            updatedAt: sql`now()`,
          },
        });
      logger.info({ name: u.name, emailDomains }, 'Seeded university');
    }
    logger.info({ count: UNIVERSITY_SEED.length }, 'University seed complete');

    for (const plan of SUBSCRIPTION_PLAN_SEED) {
      await db
        .insert(subscriptionPlans)
        .values({
          code: plan.code,
          name: plan.name,
          priceCents: plan.priceCents,
          currency: plan.currency,
          interval: plan.interval,
          isActive: plan.isActive,
        })
        .onConflictDoUpdate({
          target: subscriptionPlans.code,
          set: {
            name: plan.name,
            priceCents: plan.priceCents,
            currency: plan.currency,
            interval: plan.interval,
            isActive: plan.isActive,
          },
        });
      logger.info({ code: plan.code, priceCents: plan.priceCents }, 'Seeded subscription plan');
    }
    logger.info({ count: SUBSCRIPTION_PLAN_SEED.length }, 'Subscription plan seed complete');
  } finally {
    await seedClient.end({ timeout: 5 });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'Reference-data seed failed');
    process.exit(1);
  });
