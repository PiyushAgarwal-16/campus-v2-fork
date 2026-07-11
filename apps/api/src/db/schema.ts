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
  bigint,
  boolean,
  integer,
  jsonb,
  timestamp,
  unique,
  uniqueIndex,
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
    /** Instagram-style unique username; null for legacy Google-only users. */
    username: text('username'),
    /**
     * Permanent, unique, auto-assigned Reddit-style pseudonymous handle shown on
     * all Campus Wall content (accountable anonymity §7). Nullable: assigned
     * lazily on first wall activity. Postgres permits multiple NULLs under the
     * unique constraint.
     */
    anonHandle: text('anon_handle').unique('uq_users_anon_handle'),
    /** Scrypt hash of the user's password; null for Google-only users. */
    passwordHash: text('password_hash'),
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
    usernameUnique: unique('uq_users_username').on(t.username),
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
    avatarMediaId: uuid('avatar_media_id').references(() => mediaAssets.id, {
      onDelete: 'set null',
    }),
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
    friendshipId: uuid('friendship_id').references(() => friendships.id, { onDelete: 'cascade' }),
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
    friendshipId: uuid('friendship_id').references(() => friendships.id, { onDelete: 'cascade' }),
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

// ---------------------------------------------------------------------------
// Friend System module (DATABASE_SCHEMA.md §9) — Phase 05
// A friendship is symmetric and stored once (order-normalized user_low <
// user_high) to avoid duplicate rows. Blocks are directional and enforced
// across matching, requests, and messaging.
// ---------------------------------------------------------------------------

export const friendRequestOriginEnum = pgEnum('friend_request_origin', [
  'session',
  'profile',
  'community',
]);

export const friendRequestStatusEnum = pgEnum('friend_request_status', [
  'pending',
  'accepted',
  'rejected',
  'cancelled',
]);

/** friend_requests (§9.1) — a pending/decided request from one user to another. */
export const friendRequests = pgTable(
  'friend_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    receiverId: uuid('receiver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    origin: friendRequestOriginEnum('origin'),
    status: friendRequestStatusEnum('status').notNull().default('pending'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // At most one pending request per ordered pair (no duplicate pending).
    pendingUnique: uniqueIndex('uq_friend_requests_pending')
      .on(t.senderId, t.receiverId)
      .where(sql`status = 'pending'`),
    receiverIdx: index('idx_friend_requests_receiver_status').on(t.receiverId, t.status),
    senderIdx: index('idx_friend_requests_sender_status').on(t.senderId, t.status),
    notSelf: check('friend_requests_not_self', sql`sender_id <> receiver_id`),
  }),
);

/** friendships (§9.2) — an established, symmetric friendship; the friend-chat context. */
export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userLow: uuid('user_low')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    userHigh: uuid('user_high')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    isCloseFriendLow: boolean('is_close_friend_low').notNull().default(false),
    isCloseFriendHigh: boolean('is_close_friend_high').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    pairUnique: unique('uq_friendships_pair').on(t.userLow, t.userHigh),
    lowIdx: index('idx_friendships_user_low').on(t.userLow),
    highIdx: index('idx_friendships_user_high').on(t.userHigh),
    ordered: check('friendships_user_order', sql`user_low < user_high`),
  }),
);

/** blocked_users (§9.3) — directional block list; the strongest user control. */
export const blockedUsers = pgTable(
  'blocked_users',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.blockerId, t.blockedId] }),
    blockedIdx: index('idx_blocked_users_blocked').on(t.blockedId),
    notSelf: check('blocked_users_not_self', sql`blocker_id <> blocked_id`),
  }),
);

export type FriendRequestRow = typeof friendRequests.$inferSelect;
export type FriendshipRow = typeof friendships.$inferSelect;
export type BlockedUserRow = typeof blockedUsers.$inferSelect;

// ---------------------------------------------------------------------------
// Media module (DATABASE_SCHEMA.md §8.6, §20) — Phase 06
// The central registry linking PostgreSQL to object storage for ALL media.
// Inviolable rule: bytes live in object storage; only references live here.
// ---------------------------------------------------------------------------

export const mediaKindEnum = pgEnum('media_kind', [
  'image',
  'voice',
  'video',
  'avatar',
  'document',
]);

export const mediaStatusEnum = pgEnum('media_status', ['pending', 'active', 'expired', 'deleted']);

/** media_assets (§8.6) — one registry, many referrers (profiles, messages, ...). */
export const mediaAssets = pgTable(
  'media_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** Object-storage key/path — never a public URL (MEDIA_SYSTEM.md §9). */
    storageKey: text('storage_key').notNull(),
    kind: mediaKindEnum('kind').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    durationMs: integer('duration_ms'),
    metadata: jsonb('metadata'),
    isTemporary: boolean('is_temporary').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: mediaStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ownerIdx: index('idx_media_assets_owner').on(t.ownerId),
    statusIdx: index('idx_media_assets_status').on(t.status),
    // Cleanup job scans active temporary media past its deadline.
    expiryIdx: index('idx_media_assets_expiry')
      .on(t.expiresAt)
      .where(sql`is_temporary and status = 'active'`),
  }),
);

/** message_attachments (§8.2) — links a message to one or more media assets. */
export const messageAttachments = pgTable(
  'message_attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id').notNull(), // soft pointer (messages PK is composite)
    mediaId: uuid('media_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    messageIdx: index('idx_message_attachments_message').on(t.messageId),
    mediaIdx: index('idx_message_attachments_media').on(t.mediaId),
  }),
);

export type MediaAssetRow = typeof mediaAssets.$inferSelect;
export type MessageAttachmentRow = typeof messageAttachments.$inferSelect;

// ---------------------------------------------------------------------------
// Campus Wall module (DATABASE_SCHEMA.md §10) — Phase 07
// The public, campus-scoped feed. Read-heavy; optimized for paginated reads and
// maintained counters. Anonymous posts always retain author_id (accountability).
// ---------------------------------------------------------------------------

export const wallPostTypeEnum = pgEnum('wall_post_type', ['text', 'poll', 'announcement']);
export const contentStatusEnum = pgEnum('content_status', ['visible', 'hidden', 'removed']);
export const reactionTargetEnum = pgEnum('reaction_target_type', [
  'wall_post',
  'wall_reply',
  'community_post',
]);
export const reactionTypeEnum = pgEnum('reaction_type', [
  'like',
  'love',
  'laugh',
  'insightful',
  'support',
]);

/** wall_categories (§10.5) — global (university_id null) or per-campus. */
export const wallCategories = pgTable(
  'wall_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id').references(() => universities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: unique('uq_wall_categories_slug').on(t.universityId, t.slug),
  }),
);

/** wall_posts (§10.1) — a public campus post (named or anonymous). */
export const wallPosts = pgTable(
  'wall_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id')
      .notNull()
      .references(() => universities.id),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id), // always retained, even for anonymous (§7)
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    categoryId: uuid('category_id').references(() => wallCategories.id, { onDelete: 'set null' }),
    postType: wallPostTypeEnum('post_type').notNull().default('text'),
    body: text('body'),
    replyCount: integer('reply_count').notNull().default(0),
    reactionCount: integer('reaction_count').notNull().default(0),
    isPinned: boolean('is_pinned').notNull().default(false),
    status: contentStatusEnum('status').notNull().default('visible'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    feedIdx: index('idx_wall_posts_feed')
      .on(t.universityId, t.createdAt)
      .where(sql`status = 'visible' and deleted_at is null`),
    authorIdx: index('idx_wall_posts_author').on(t.authorId),
    categoryIdx: index('idx_wall_posts_category').on(t.categoryId),
  }),
);

/** wall_replies (§10.2) — one-level reply to a post. */
export const wallReplies = pgTable(
  'wall_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => wallPosts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    body: text('body').notNull(),
    reactionCount: integer('reaction_count').notNull().default(0),
    status: contentStatusEnum('status').notNull().default('visible'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    postIdx: index('idx_wall_replies_post').on(t.postId, t.createdAt),
  }),
);

/** reactions (§10.3) — single polymorphic table for posts/replies. */
export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    targetType: reactionTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(), // polymorphic; app-enforced integrity
    type: reactionTypeEnum('type').notNull().default('like'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    onegPerTarget: unique('uq_reactions_user_target').on(t.userId, t.targetType, t.targetId),
    targetIdx: index('idx_reactions_target').on(t.targetType, t.targetId),
  }),
);

/** bookmarks (§10.4) — private saved posts. */
export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => wallPosts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.postId] }),
    userIdx: index('idx_bookmarks_user').on(t.userId, t.createdAt),
  }),
);

/** tags (§10.6) — normalized tag vocabulary. */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ nameUnique: unique('uq_tags_name').on(t.name) }),
);

/** post_tags (§10.7) — many-to-many post↔tag join. */
export const postTags = pgTable(
  'post_tags',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => wallPosts.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.postId, t.tagId] }),
    tagIdx: index('idx_post_tags_tag').on(t.tagId),
  }),
);

/** trending_posts (§10.8) — materialized time-decayed ranking (read cheaply). */
export const trendingPosts = pgTable('trending_posts', {
  postId: uuid('post_id')
    .primaryKey()
    .references(() => wallPosts.id, { onDelete: 'cascade' }),
  universityId: uuid('university_id')
    .notNull()
    .references(() => universities.id),
  score: integer('score').notNull().default(0),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
});

/** post_media (§10.9) — post↔media join, mirrors message_attachments. */
export const postMedia = pgTable(
  'post_media',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => wallPosts.id, { onDelete: 'cascade' }),
    mediaId: uuid('media_id')
      .notNull()
      .references(() => mediaAssets.id, { onDelete: 'restrict' }),
    position: smallint('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.postId, t.mediaId] }) }),
);

/**
 * Poll storage (PUBLIC_WALL.md §3 "Poll: native voting; option limits enforced").
 * The schema enumerates `poll` as a post_type; these tables implement its native
 * voting (one vote per user per poll, changeable).
 */
export const wallPollOptions = pgTable(
  'wall_poll_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    postId: uuid('post_id')
      .notNull()
      .references(() => wallPosts.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    position: smallint('position').notNull().default(0),
    voteCount: integer('vote_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ postIdx: index('idx_wall_poll_options_post').on(t.postId) }),
);

export const wallPollVotes = pgTable(
  'wall_poll_votes',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => wallPosts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    optionId: uuid('option_id')
      .notNull()
      .references(() => wallPollOptions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.postId, t.userId] }) }),
);

export type WallPostRow = typeof wallPosts.$inferSelect;
export type WallReplyRow = typeof wallReplies.$inferSelect;
export type WallCategoryRow = typeof wallCategories.$inferSelect;
export type ReactionRow = typeof reactions.$inferSelect;
export type WallPollOptionRow = typeof wallPollOptions.$inferSelect;

// ---------------------------------------------------------------------------
// Moderation hook (DATABASE_SCHEMA.md §15.1) — Phase 07 wires report creation;
// the moderation tooling (actions, queue, appeals) lands in Phase 12.
// ---------------------------------------------------------------------------

export const reportTargetEnum = pgEnum('report_target_type', [
  'user',
  'wall_post',
  'wall_reply',
  'community_post',
  'message',
  'marketplace_item',
  'lost_found_item',
]);
export const reportReasonEnum = pgEnum('report_reason', [
  'spam',
  'harassment',
  'hate',
  'nsfw',
  'safety',
  'other',
]);
export const reportStatusEnum = pgEnum('report_status', [
  'open',
  'reviewing',
  'resolved',
  'dismissed',
]);

/** reports (§15.1) — user-filed report against content or a user. */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    targetType: reportTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    reason: reportReasonEnum('reason').notNull(),
    details: text('details'),
    status: reportStatusEnum('status').notNull().default('open'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    queueIdx: index('idx_reports_queue')
      .on(t.createdAt)
      .where(sql`status in ('open','reviewing')`),
    targetIdx: index('idx_reports_target').on(t.targetType, t.targetId),
  }),
);

export type ReportRow = typeof reports.$inferSelect;

// ---------------------------------------------------------------------------
// Communities & Clubs module (DATABASE_SCHEMA.md §11) — Phase 09
// A club is a specialized community. Community posts mirror wall_posts but are
// scoped by community_id; reactions reuse the polymorphic reactions table.
// ---------------------------------------------------------------------------

export const communityTypeEnum = pgEnum('community_type', ['community', 'club']);
export const communityVisibilityEnum = pgEnum('community_visibility', [
  'public',
  'request',
  'invite',
]);
export const communityRoleEnum = pgEnum('community_role', ['owner', 'moderator', 'member']);
export const communityMemberStatusEnum = pgEnum('community_member_status', [
  'active',
  'pending',
  'banned',
]);
export const communityInviteStatusEnum = pgEnum('community_invite_status', [
  'pending',
  'accepted',
  'declined',
  'expired',
]);
export const communityPostTypeEnum = pgEnum('community_post_type', ['text', 'announcement']);

/** communities (§11.1) — a group/club, optionally campus-scoped. */
export const communities = pgTable(
  'communities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id').references(() => universities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    type: communityTypeEnum('type').notNull().default('community'),
    visibility: communityVisibilityEnum('visibility').notNull().default('public'),
    isVerified: boolean('is_verified').notNull().default(false),
    iconMediaId: uuid('icon_media_id').references(() => mediaAssets.id, { onDelete: 'set null' }),
    memberCount: integer('member_count').notNull().default(0),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    slugUnique: unique('uq_communities_slug').on(t.universityId, t.slug),
    universityIdx: index('idx_communities_university').on(t.universityId),
    typeIdx: index('idx_communities_type').on(t.type),
  }),
);

/** community_members (§11.2) — membership join with community RBAC. */
export const communityMembers = pgTable(
  'community_members',
  {
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: communityRoleEnum('role').notNull().default('member'),
    status: communityMemberStatusEnum('status').notNull().default('active'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.communityId, t.userId] }),
    userIdx: index('idx_community_members_user').on(t.userId),
  }),
);

/** community_posts (§11.3) — posts within a community (mirrors wall_posts). */
export const communityPosts = pgTable(
  'community_posts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    postType: communityPostTypeEnum('post_type').notNull().default('text'),
    body: text('body'),
    reactionCount: integer('reaction_count').notNull().default(0),
    status: contentStatusEnum('status').notNull().default('visible'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    feedIdx: index('idx_community_posts_feed')
      .on(t.communityId, t.createdAt)
      .where(sql`status = 'visible' and deleted_at is null`),
  }),
);

/** community_invites (§11.4) — pending invitations for request/invite communities. */
export const communityInvites = pgTable(
  'community_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    communityId: uuid('community_id')
      .notNull()
      .references(() => communities.id, { onDelete: 'cascade' }),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id),
    inviteeId: uuid('invitee_id')
      .notNull()
      .references(() => users.id),
    status: communityInviteStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pendingUnique: uniqueIndex('uq_community_invites_pending')
      .on(t.communityId, t.inviteeId)
      .where(sql`status = 'pending'`),
    inviteeIdx: index('idx_community_invites_invitee').on(t.inviteeId, t.status),
  }),
);

export type CommunityRow = typeof communities.$inferSelect;
export type CommunityMemberRow = typeof communityMembers.$inferSelect;
export type CommunityPostRow = typeof communityPosts.$inferSelect;
export type CommunityInviteRow = typeof communityInvites.$inferSelect;

// ---------------------------------------------------------------------------
// Moderation module (DATABASE_SCHEMA.md §15.2–15.7) — Phase 12
// Graduated enforcement; every action is written transactionally with an
// immutable audit_logs entry. reports table was created in Phase 07.
// ---------------------------------------------------------------------------

export const moderationActionEnum = pgEnum('moderation_action', [
  'hide_content',
  'remove_content',
  'warn',
  'restrict',
  'ban',
  'dismiss',
]);
export const banTypeEnum = pgEnum('ban_type', ['temporary', 'permanent']);
export const appealStatusEnum = pgEnum('appeal_status', ['pending', 'upheld', 'overturned']);
export const announcementAudienceEnum = pgEnum('announcement_audience', [
  'all',
  'campus',
  'subscribers',
  'admins',
]);

/** moderation_actions (§15.2) — a concrete action; append-only. */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    moderatorId: uuid('moderator_id')
      .notNull()
      .references(() => users.id),
    reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),
    targetType: reportTargetEnum('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    action: moderationActionEnum('action').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reportIdx: index('idx_moderation_actions_report').on(t.reportId),
    targetIdx: index('idx_moderation_actions_target').on(t.targetType, t.targetId),
  }),
);

/** user_warnings (§15.3) — graduated-enforcement warnings. */
export const userWarnings = pgTable(
  'user_warnings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actionId: uuid('action_id').references(() => moderationActions.id, { onDelete: 'set null' }),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ userIdx: index('idx_user_warnings_user').on(t.userId, t.createdAt) }),
);

/** user_bans (§15.4) — active/historical bans and temporary restrictions. */
export const userBans = pgTable(
  'user_bans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actionId: uuid('action_id').references(() => moderationActions.id, { onDelete: 'set null' }),
    type: banTypeEnum('type').notNull(),
    reason: text('reason'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    activeIdx: index('idx_user_bans_active')
      .on(t.userId)
      .where(sql`is_active`),
    endsIdx: index('idx_user_bans_ends').on(t.endsAt),
  }),
);

/** moderation_appeals (§15.5) — user appeals against actions. */
export const moderationAppeals = pgTable(
  'moderation_appeals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actionId: uuid('action_id')
      .notNull()
      .references(() => moderationActions.id, { onDelete: 'cascade' }),
    message: text('message').notNull(),
    status: appealStatusEnum('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => ({ statusIdx: index('idx_moderation_appeals_status').on(t.status, t.createdAt) }),
);

/** audit_logs (§15.7) — immutable, append-only accountability ledger. */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index('idx_audit_logs_actor').on(t.actorId, t.createdAt),
    targetIdx: index('idx_audit_logs_target').on(t.targetType, t.targetId),
    actionIdx: index('idx_audit_logs_action').on(t.action),
  }),
);

// ---------------------------------------------------------------------------
// System module (DATABASE_SCHEMA.md §19.2, §19.4) — Phase 12
// ---------------------------------------------------------------------------

/** feature_flags (§19.2) — platform-wide toggles for safe rollout / kill-switch. */
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    isEnabled: boolean('is_enabled').notNull().default(false),
    rollout: jsonb('rollout'),
    description: text('description'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ keyUnique: unique('uq_feature_flags_key').on(t.key) }),
);

/** announcements (§19.4) — system/admin announcements, global or per-campus. */
export const announcements = pgTable(
  'announcements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    universityId: uuid('university_id').references(() => universities.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    audience: announcementAudienceEnum('audience').notNull().default('all'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ campusIdx: index('idx_announcements_campus').on(t.universityId, t.startsAt) }),
);

export type ModerationActionRow = typeof moderationActions.$inferSelect;
export type UserBanRow = typeof userBans.$inferSelect;
export type UserWarningRow = typeof userWarnings.$inferSelect;
export type ModerationAppealRow = typeof moderationAppeals.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type FeatureFlagRow = typeof featureFlags.$inferSelect;
export type AnnouncementRow = typeof announcements.$inferSelect;

// ---------------------------------------------------------------------------
// Notifications module (DATABASE_SCHEMA.md §16.1) — in-app notifications.
// Domain events persist a notification and push it live over the socket.
// ---------------------------------------------------------------------------

export const notificationTypeEnum = pgEnum('notification_type', [
  'friend_request',
  'friend_accepted',
  'match',
  'message',
  'wall_reply',
  'wall_reaction',
  'community',
  'announcement',
  'moderation',
  'system',
]);

/** notifications (§16.1) — a user-facing in-app notification. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    data: jsonb('data'),
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index('idx_notifications_user_created').on(t.userId, t.createdAt),
    unreadIdx: index('idx_notifications_unread')
      .on(t.userId)
      .where(sql`is_read = false`),
  }),
);

export type NotificationRow = typeof notifications.$inferSelect;

// ---------------------------------------------------------------------------
// Subscription module (DATABASE_SCHEMA.md §17) — Admin Control Center
// New authoritative subscription tables. The existing subscriptionStatusEnum
// (free/premium) on users is retained as the denormalized cache, kept in sync
// with these tables by subscriptionService (Admin Control Center design).
// ---------------------------------------------------------------------------

export const subscriptionIntervalEnum = pgEnum('subscription_interval', [
  'none',
  'monthly',
  'yearly',
]);

export const userSubscriptionStatusEnum = pgEnum('user_subscription_status', [
  'active',
  'cancelled',
  'expired',
  'granted',
]);

export const subscriptionSourceEnum = pgEnum('subscription_source', [
  'purchase',
  'admin_grant',
  'trial',
]);

export const subscriptionTxnTypeEnum = pgEnum('subscription_txn_type', ['payment', 'refund']);

export const subscriptionTxnStatusEnum = pgEnum('subscription_txn_status', [
  'pending',
  'succeeded',
  'failed',
]);

/** subscription_plans (§17.1) — catalog of purchasable/grantable plans. */
export const subscriptionPlans = pgTable(
  'subscription_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    priceCents: integer('price_cents').notNull().default(0),
    currency: text('currency').notNull().default('INR'),
    interval: subscriptionIntervalEnum('interval').notNull(),
    features: jsonb('features').notNull().default({}),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUnique: unique('uq_subscription_plans_code').on(t.code),
  }),
);

/** user_subscriptions (§17.2) — a user's authoritative subscription state. */
export const userSubscriptions = pgTable(
  'user_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => subscriptionPlans.id),
    status: userSubscriptionStatusEnum('status').notNull(),
    source: subscriptionSourceEnum('source').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Partial index for entitlement checks: at most one live sub per user is expected.
    activeIdx: index('idx_user_subscriptions_active')
      .on(t.userId)
      .where(sql`status in ('active','granted')`),
    periodEndIdx: index('idx_user_subscriptions_period_end').on(t.currentPeriodEnd),
  }),
);

/** subscription_transactions (§17.3) — billing events for a subscription. */
export const subscriptionTransactions = pgTable(
  'subscription_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => userSubscriptions.id, { onDelete: 'cascade' }),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('INR'),
    type: subscriptionTxnTypeEnum('type').notNull(),
    status: subscriptionTxnStatusEnum('status').notNull(),
    provider: text('provider'),
    providerRef: text('provider_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerRefUnique: unique('uq_subscription_txn_provider_ref').on(t.provider, t.providerRef),
    subscriptionIdx: index('idx_subscription_txn_subscription').on(t.subscriptionId),
  }),
);

export type SubscriptionPlanRow = typeof subscriptionPlans.$inferSelect;
export type UserSubscriptionRow = typeof userSubscriptions.$inferSelect;
export type SubscriptionTransactionRow = typeof subscriptionTransactions.$inferSelect;
