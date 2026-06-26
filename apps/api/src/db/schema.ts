/**
 * Drizzle schema — the single source of truth for the database (DATABASE_SCHEMA.md §26.7).
 *
 * Phase 01 introduces the Authentication module (DATABASE_SCHEMA.md §5):
 * universities, branches, users, google_accounts, refresh_tokens,
 * login_history, user_devices. Later phases add their own tables.
 *
 * Conventions (DATABASE_SCHEMA.md §1, §26):
 * - UUID primary keys via gen_random_uuid() (v4 fallback; UUIDv7 is future — REVIEW_REPORT L-4).
 * - timestamptz in UTC; created_at on every table; updated_at where mutable.
 * - snake_case columns (enforced by drizzle.config `casing: 'snake_case'`).
 * - Email stored normalized-lowercase as text with a unique index (citext is a
 *   future optimization; app normalizes case — DATABASE_SCHEMA.md §5.3).
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  smallint,
  boolean,
  timestamp,
  unique,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums (resolved canonical sets — REVIEW_REPORT C-1, C-2)
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', [
  'student',
  'community_moderator',
  'club_admin',
  'moderator',
  'admin',
  'super_admin',
]);

export const accountStatusEnum = pgEnum('account_status', [
  'pending_verification',
  'active',
  'restricted',
  'suspended',
  'banned',
  'deactivated',
]);

export const subscriptionStatusEnum = pgEnum('subscription_status', ['free', 'premium']);

export const loginEventEnum = pgEnum('login_event', [
  'login_success',
  'login_failure',
  'refresh',
  'logout',
]);

export const devicePlatformEnum = pgEnum('device_platform', ['web', 'ios', 'android']);

// ---------------------------------------------------------------------------
// universities (DATABASE_SCHEMA.md §5.1) — root of campus scoping
// ---------------------------------------------------------------------------

export const universities = pgTable(
  'universities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    shortName: text('short_name'),
    /** Verified institutional domains used for sign-in eligibility. */
    emailDomains: text('email_domains').array().notNull(),
    city: text('city'),
    state: text('state'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameUnique: unique('uq_universities_name').on(t.name),
  }),
);

// ---------------------------------------------------------------------------
// branches (DATABASE_SCHEMA.md §5.2)
// ---------------------------------------------------------------------------

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    perUniversityUnique: unique('uq_branches_university_name').on(t.universityId, t.name),
    universityIdx: index('idx_branches_university').on(t.universityId),
  }),
);

// ---------------------------------------------------------------------------
// users (DATABASE_SCHEMA.md §5.3) — canonical account record
// ---------------------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    /** Verified institutional email, stored normalized lowercase; unique. */
    email: text('email').notNull(),
    name: text('name').notNull(),
    year: smallint('year'),
    role: userRoleEnum('role').notNull().default('student'),
    accountStatus: accountStatusEnum('account_status').notNull().default('pending_verification'),
    subscriptionStatus: subscriptionStatusEnum('subscription_status').notNull().default('free'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    emailUnique: unique('uq_users_email').on(t.email),
    universityIdx: index('idx_users_university').on(t.universityId),
  }),
);

// ---------------------------------------------------------------------------
// google_accounts (DATABASE_SCHEMA.md §5.4) — OAuth identity link
// ---------------------------------------------------------------------------

export const googleAccounts = pgTable(
  'google_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Google's stable subject identifier. */
    googleSub: text('google_sub').notNull(),
    email: text('email').notNull(),
    pictureUrl: text('picture_url'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subUnique: unique('uq_google_accounts_sub').on(t.googleSub),
    userUnique: unique('uq_google_accounts_user').on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// refresh_tokens (DATABASE_SCHEMA.md §5.5) — rotated, revocable, hashed
// ---------------------------------------------------------------------------

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 hash of the token — never the raw token (AUTH_SYSTEM.md §5). */
    tokenHash: text('token_hash').notNull(),
    deviceId: uuid('device_id').references(() => userDevices.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    replacedBy: uuid('replaced_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    hashUnique: unique('uq_refresh_tokens_hash').on(t.tokenHash),
    userIdx: index('idx_refresh_tokens_user').on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// login_history (DATABASE_SCHEMA.md §5.6) — append-only security audit
// ---------------------------------------------------------------------------

export const loginHistory = pgTable(
  'login_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    event: loginEventEnum('event').notNull(),
    ipHash: text('ip_hash'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index('idx_login_history_user_created').on(t.userId, t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// user_devices (DATABASE_SCHEMA.md §5.7) — future-ready (push, multi-device)
// ---------------------------------------------------------------------------

export const userDevices = pgTable(
  'user_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceLabel: text('device_label'),
    platform: devicePlatformEnum('platform'),
    pushToken: text('push_token'),
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('idx_user_devices_user').on(t.userId),
  }),
);

// Convenience row types
export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UniversityRow = typeof universities.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
