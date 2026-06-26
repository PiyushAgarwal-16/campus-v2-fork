import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit configuration (DATABASE_SCHEMA.md §26.7).
 * Migrations are generated SQL, reviewed, committed, and forward-only in production.
 *
 * This file is consumed by the drizzle-kit CLI (its own bundler), so it reads
 * DATABASE_URL directly from the environment rather than importing the app's
 * runtime config module. Still no hardcoded secrets (SECURITY.md §10).
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run drizzle-kit.');
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  casing: 'snake_case',
  strict: true,
  verbose: true,
});
