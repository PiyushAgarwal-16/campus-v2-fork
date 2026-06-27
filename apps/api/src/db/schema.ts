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
  integer,
  jsonb,
  timestamp,
  unique,
  index,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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

// --- Profile module enums (DATABASE_SCHEMA.md §6) ---

export const genderEnum = pgEnum('gender', ['male', 'female', 'other', 'prefer_not']);

export const moderationStatusEnum = pgEnum('moderation_status', ['clear', 'flagged', 'restricted']);

export const profileVisibilityEnum = pgEnum('profile_visibility', ['campus', 'friends', 'private']);

export const friendRequestPolicyEnum = pgEnum('friend_request_policy', [
  'everyone',
  'campus',
  'none',
]);

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

// ---------------------------------------------------------------------------
// Profile module (DATABASE_SCHEMA.md §6) — Phase 02
// ---------------------------------------------------------------------------

/**
 * profiles (DATABASE_SCHEMA.md §6.1) — 1:1 extension of users with displayable,
 * editable identity. `avatar_media_id` references media_assets, which is created
 * in Phase 06 (Media); it is a nullable column without an FK until then.
 */
export const profiles = pgTable(
  'profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    avatarMediaId: uuid('avatar_media_id'), // FK to media_assets added in Phase 06
    gender: genderEnum('gender'),
    bio: text('bio'),
    moderationStatus: moderationStatusEnum('moderation_status').notNull().default('clear'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUnique: unique('uq_profiles_user').on(t.userId),
  }),
);

/** interests (DATABASE_SCHEMA.md §6.2) — normalized interest vocabulary. */
export const interests = pgTable(
  'interests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameUnique: unique('uq_interests_name').on(t.name),
  }),
);

/** user_interests (DATABASE_SCHEMA.md §6.2) — many-to-many join. */
export const userInterests = pgTable(
  'user_interests',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    interestId: uuid('interest_id')
      .notNull()
      .references(() => interests.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.interestId] }),
    interestIdx: index('idx_user_interests_interest').on(t.interestId),
  }),
);

/**
 * privacy_settings (DATABASE_SCHEMA.md §6.3) — per-user privacy controls
 * (Privacy by Design). One row per user, privacy-friendly defaults.
 */
export const privacySettings = pgTable(
  'privacy_settings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    showLastSeen: boolean('show_last_seen').notNull().default(true),
    showOnlineStatus: boolean('show_online_status').notNull().default(true),
    sendReadReceipts: boolean('send_read_receipts').notNull().default(true),
    profileVisibility: profileVisibilityEnum('profile_visibility').notNull().default('campus'),
    allowFriendRequests: friendRequestPolicyEnum('allow_friend_requests')
      .notNull()
      .default('everyone'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUnique: unique('uq_privacy_settings_user').on(t.userId),
  }),
);

export type ProfileRow = typeof profiles.$inferSelect;
export type PrivacySettingsRow = typeof privacySettings.$inferSelect;
export type InterestRow = typeof interests.$inferSelect;

// ---------------------------------------------------------------------------
// Anonymous Matching module (DATABASE_SCHEMA.md §7) — Phase 03
// ---------------------------------------------------------------------------

export const matchQueueStatusEnum = pgEnum('match_queue_status', [
  'waiting',
  'matched',
  'cancelled',
]);

export const anonSessionStatusEnum = pgEnum('anon_session_status', ['active', 'ended', 'expired']);

export const sessionEndReasonEnum = pgEnum('session_end_reason', [
  'left',
  'disconnect',
  'expired',
  'reported',
]);

/** match_queue (§7.1) — persisted waiting users for recovery + stale cleanup. */
export const matchQueue = pgTable(
  'match_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id),
    status: matchQueueStatusEnum('status').notNull().default('waiting'),
    preferences: jsonb('preferences'),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUnique: unique('uq_match_queue_user').on(t.userId),
    waitingIdx: index('idx_match_queue_waiting').on(t.universityId, t.createdAt),
    heartbeatIdx: index('idx_match_queue_heartbeat').on(t.lastHeartbeatAt),
  }),
);

/** anon_sessions (§7.2) — an anonymous session between matched users. */
export const anonSessions = pgTable(
  'anon_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id),
    status: anonSessionStatusEnum('status').notNull().default('active'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    endReason: sessionEndReasonEnum('end_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    startedIdx: index('idx_anon_sessions_started').on(t.startedAt),
  }),
);

/** session_participants (§7.3) — the (two) users in a session. */
export const sessionParticipants = pgTable(
  'session_participants',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => anonSessions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    leftAt: timestamp('left_at', { withTimezone: true }),
    sentFriendRequest: boolean('sent_friend_request').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.sessionId, t.userId] }),
    userIdx: index('idx_session_participants_user').on(t.userId),
  }),
);

/** match_history (§7.4) — completed-match summary for analytics + rematch rules. */
export const matchHistory = pgTable(
  'match_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => anonSessions.id, { onDelete: 'set null' }),
    userA: uuid('user_a')
      .notNull()
      .references(() => users.id),
    userB: uuid('user_b')
      .notNull()
      .references(() => users.id),
    durationSeconds: integer('duration_seconds'),
    becameFriends: boolean('became_friends').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userAIdx: index('idx_match_history_user_a').on(t.userA, t.createdAt),
    userBIdx: index('idx_match_history_user_b').on(t.userB, t.createdAt),
  }),
);

export type AnonSessionRow = typeof anonSessions.$inferSelect;
export type MatchQueueRow = typeof matchQueue.$inferSelect;

// ---------------------------------------------------------------------------
// Messaging module (DATABASE_SCHEMA.md §8) — Phase 04
// Unified model: a message belongs to exactly one context (anon_session now;
// friendship activates in Phase 05). Media attachments arrive in Phase 06.
// ---------------------------------------------------------------------------

export const messageContextEnum = pgEnum('message_context_type', ['anon_session', 'friendship']);

export const messageTypeEnum = pgEnum('message_type', ['text', 'voice', 'image', 'system']);

export const messageDeliveryEnum = pgEnum('message_delivery_status', ['sent', 'delivered', 'read']);

/**
 * messages (§8.1). Partition-ready: PK is composite (created_at, id) so the
 * table can be range-partitioned by time later (REVIEW_REPORT H-2). One context
 * FK is set per row, matching context_type (enforced by a check constraint).
 * `friendship_id` has no FK until the friendships table exists (Phase 05).
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').notNull().defaultRandom(),
    contextType: messageContextEnum('context_type').notNull(),
    sessionId: uuid('session_id').references(() => anonSessions.id, { onDelete: 'cascade' }),
    friendshipId: uuid('friendship_id'), // FK added in Phase 05 (friendships)
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id),
    type: messageTypeEnum('type').notNull().default('text'),
    body: text('body'),
    hasAttachment: boolean('has_attachment').notNull().default(false),
    deliveryStatus: messageDeliveryEnum('delivery_status').notNull().default('sent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.createdAt, t.id] }),
    sessionIdx: index('idx_messages_session_created').on(t.sessionId, t.createdAt),
    friendshipIdx: index('idx_messages_friendship_created').on(t.friendshipId, t.createdAt),
    contextCheck: check(
      'messages_one_context',
      sql`(context_type = 'anon_session' and session_id is not null and friendship_id is null)
          or (context_type = 'friendship' and friendship_id is not null and session_id is null)`,
    ),
  }),
);

/**
 * message_receipts (§8.4) — authoritative read state as a high-water mark per
 * user per conversation (REVIEW_REPORT M-2: receipts are the source of truth for
 * "read"; messages.delivery_status is a coarse per-message indicator).
 * `last_read_message_id` is a soft pointer (no FK — messages PK is composite).
 */
export const messageReceipts = pgTable(
  'message_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contextType: messageContextEnum('context_type').notNull(),
    sessionId: uuid('session_id').references(() => anonSessions.id, { onDelete: 'cascade' }),
    friendshipId: uuid('friendship_id'),
    lastReadMessageId: uuid('last_read_message_id'),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    perConversationUnique: unique('uq_message_receipts_conversation').on(
      t.userId,
      t.contextType,
      t.sessionId,
      t.friendshipId,
    ),
  }),
);

export type MessageRow = typeof messages.$inferSelect;
