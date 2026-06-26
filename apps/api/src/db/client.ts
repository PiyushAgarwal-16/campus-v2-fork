import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as schema from './schema.js';

/**
 * PostgreSQL connection + Drizzle ORM client (TECH_STACK.md §5.3).
 * A single pooled connection is shared across the process; the service/
 * repository layers consume `db`, never `postgres` directly.
 */
const queryClient = postgres(config.DATABASE_URL, {
  max: 10,
  onnotice: () => {},
});

export const db = drizzle(queryClient, { schema });

/** Lightweight connectivity probe used by the health endpoint. */
export async function checkDatabase(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch (err) {
    logger.error({ err }, 'Database connectivity check failed');
    return false;
  }
}

/** Graceful shutdown hook (called on SIGINT/SIGTERM). */
export async function closeDatabase(): Promise<void> {
  await queryClient.end({ timeout: 5 });
}
