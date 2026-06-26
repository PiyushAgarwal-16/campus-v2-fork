import 'dotenv/config';
import { z } from 'zod';

/**
 * Typed, validated environment configuration (SECURITY.md §10, CODING_STANDARDS.md §13.5).
 * No secret is ever hardcoded; everything comes from the environment and is
 * validated once at startup so the process fails fast on misconfiguration.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Authentication (AUTH_SYSTEM.md §3–5). Secrets are never hardcoded.
  GOOGLE_CLIENT_ID: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  /** Access-token lifetime in seconds (short-lived — AUTH_SYSTEM.md §5). */
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  /** Refresh-token lifetime in days (longer-lived, rotated, revocable). */
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Grace window (days) for account-deletion recovery before PII purge (AUTH_SYSTEM.md §8). */
  ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().positive().default(14),
});

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Surface which keys are wrong without printing their (possibly secret) values.
    const issues = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  return parsed.data;
}

export const config = loadConfig();

export type AppConfig = typeof config;

export const isProduction = config.NODE_ENV === 'production';
export const isDevelopment = config.NODE_ENV === 'development';
