import { z } from 'zod';
import { USER_ROLES } from './auth.js';
import type { UserRole, AccountStatus, SubscriptionStatus } from './auth.js';
import { REPORT_TARGETS } from './wall.js';
import type { ContentStatus } from './wall.js';
import type { MessageType, MessageContextType, ChatAttachment } from './messaging.js';
import type { MediaKind, MediaStatus } from './media.js';

/**
 * Admin & Moderation contracts (ADMIN_PANEL.md, DATABASE_SCHEMA.md §15, §19,
 * API_SPEC.md §15). All admin endpoints are RBAC-gated server-side. Graduated
 * enforcement: dismiss / warn → restrict → suspend → ban, all audit-logged.
 */

/** Roles allowed into moderation surfaces, and into full admin surfaces. */
export const MODERATOR_ROLES: UserRole[] = ['moderator', 'admin', 'super_admin'];
export const ADMIN_ROLES: UserRole[] = ['admin', 'super_admin'];
/** Roles allowed to perform irreversible / role-management actions (ADMIN_PANEL.md §2). */
export const SUPER_ADMIN_ROLES: UserRole[] = ['super_admin'];

export const MODERATION_ACTIONS = [
  'hide_content',
  'remove_content',
  'warn',
  'restrict',
  'ban',
  'dismiss',
] as const;
export type ModerationActionType = (typeof MODERATION_ACTIONS)[number];

export const BAN_TYPES = ['temporary', 'permanent'] as const;
export type BanType = (typeof BAN_TYPES)[number];

export const APPEAL_STATUSES = ['pending', 'upheld', 'overturned'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const ANNOUNCEMENT_AUDIENCES = ['all', 'campus', 'subscribers', 'admins'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// --- DTOs ---

export interface AdminReport {
  id: string;
  reporterId: string | null;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  accountStatus: AccountStatus;
  subscriptionStatus: SubscriptionStatus;
  universityId: string;
  createdAt: string;
}

export interface UserWarningItem {
  id: string;
  message: string | null;
  createdAt: string;
}
export interface UserBanItem {
  id: string;
  type: BanType;
  reason: string | null;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
}
export interface AdminActionItem {
  id: string;
  action: ModerationActionType;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: string;
}
export interface UserHistory {
  user: AdminUser;
  warnings: UserWarningItem[];
  bans: UserBanItem[];
  recentActions: AdminActionItem[];
  reportsAgainst: number;
}

export interface DashboardMetrics {
  totalUsers: number;
  activeUsers: number;
  pendingReports: number;
  postsToday: number;
  communities: number;
  premiumUsers: number;
}

export interface FeatureFlag {
  key: string;
  isEnabled: boolean;
  description: string | null;
}

export interface Announcement {
  id: string;
  universityId: string | null;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

export interface AuditLogItem {
  id: string;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export interface Appeal {
  id: string;
  userId: string;
  actionId: string;
  message: string;
  status: AppealStatus;
  createdAt: string;
}

// --- Request schemas ---

/** Apply a moderation action to a report's target or proactively. */
export const ApplyActionSchema = z.object({
  targetType: z.enum(REPORT_TARGETS),
  targetId: z.string().uuid(),
  action: z.enum(MODERATION_ACTIONS),
  reason: z.string().trim().max(1000).optional(),
  reportId: z.string().uuid().optional(),
  /** For restrict/ban: hours for a temporary action; omit = permanent. */
  durationHours: z.number().int().positive().max(8760).optional(),
});
export type ApplyActionInput = z.infer<typeof ApplyActionSchema>;

export const ResolveReportSchema = z.object({
  status: z.enum(['reviewing', 'resolved', 'dismissed']),
});

export const SetUserStatusSchema = z.object({
  status: z.enum(['active', 'restricted', 'suspended', 'banned']),
  reason: z.string().trim().max(1000).optional(),
  durationHours: z.number().int().positive().max(8760).optional(),
});
export type SetUserStatusInput = z.infer<typeof SetUserStatusSchema>;

export const CreateAnnouncementSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(4000),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES).default('all'),
  campusScoped: z.boolean().default(false),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});
export type CreateAnnouncementInput = z.infer<typeof CreateAnnouncementSchema>;

export const ToggleFlagSchema = z.object({ isEnabled: z.boolean() });

export const CreateAppealSchema = z.object({
  actionId: z.string().uuid(),
  message: z.string().trim().min(1).max(2000),
});
export type CreateAppealInput = z.infer<typeof CreateAppealSchema>;

export const ResolveAppealSchema = z.object({ status: z.enum(['upheld', 'overturned']) });

/** A selectable campus for admin pickers (e.g. manual user creation). */
export interface UniversityOption {
  id: string;
  name: string;
  shortName: string | null;
}

// --- Manual user creation (Requirement 4) ---

/**
 * Manually create an account. Produces a `pending_verification`, `student`
 * record bound to a recognized institutional email domain; the account still
 * completes Google verification before becoming usable (AUTH_SYSTEM.md §1–3).
 */
export const CreateUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email(),
  universityId: z.string().uuid(),
  /**
   * Admin-set password. The account is created ACTIVE and can sign in directly
   * with email + password — no Google verification required (Req 4, admin
   * full-authority creation).
   */
  password: z.string().min(8).max(200),
});
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// --- User lifecycle: edit / role change / delete (Requirement 5) ---

/**
 * Edit an existing user's permitted profile fields. Verified fields
 * (`universityId`, `branchId`, `year`) are intentionally absent and remain
 * immutable via service-layer rejection (AUTH_SYSTEM.md §8, Req 5.4).
 */
export const EditUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  bio: z.string().trim().max(500).optional(),
  avatarMediaId: z.string().uuid().nullable().optional(),
});
export type EditUserInput = z.infer<typeof EditUserSchema>;

/** Change a user's role (Super Admin only, ADMIN_PANEL.md §2, Req 5.5). */
export const ChangeRoleSchema = z.object({
  role: z.enum(USER_ROLES),
  reason: z.string().trim().min(1).max(1000),
});
export type ChangeRoleInput = z.infer<typeof ChangeRoleSchema>;

/** Soft-delete a user (Super Admin only, requires explicit confirmation, Req 5.7). */
export const DeleteUserSchema = z.object({
  confirm: z.literal(true),
  reason: z.string().trim().min(1).max(1000),
});
export type DeleteUserInput = z.infer<typeof DeleteUserSchema>;

// --- Bulk actions + destructive confirmation (Requirements 11, 12) ---

/**
 * Apply an action to up to 100 targets. `confirm` is required by the service
 * for destructive variants; irreversible variants additionally require Super
 * Admin (Req 11.2, 11.4, 12.3).
 */
export const BulkActionSchema = z.object({
  action: z.enum(['restrict', 'ban', 'delete', 'revoke_subscription']),
  targetIds: z.array(z.string().uuid()).min(1).max(100),
  reason: z.string().trim().max(1000).optional(),
  confirm: z.literal(true).optional(),
});
export type BulkActionInput = z.infer<typeof BulkActionSchema>;

/** Per-target outcome of a bulk action (Req 11.3). */
export interface BulkActionResult {
  targetId: string;
  ok: boolean;
  error: string | null;
}

// --- Data inspection: scoped conversation inspection (Requirement 8) ---

/**
 * Request a scoped conversation transcript. Moderator-only, report/investigation
 * scoped (never open browsing); a resolving `reportId` OR `investigationContext`
 * is required (Req 8.3, 8.4).
 */
export const InspectConversationSchema = z
  .object({
    contextType: z.enum(['anon_session', 'friendship']),
    conversationId: z.string().uuid(),
    reportId: z.string().uuid().optional(),
    investigationContext: z.string().trim().max(500).optional(),
  })
  .refine((v) => Boolean(v.reportId) || Boolean(v.investigationContext), {
    message: 'Report or investigation context required',
  });
export type InspectConversationInput = z.infer<typeof InspectConversationSchema>;

// --- Report_Context DTOs (Requirement 7) ---

/**
 * A single message within a report/inspection transcript window. Mirrors the
 * client `ChatMessage` shape but scoped to what an Operator may review.
 */
export interface TranscriptMessage {
  id: string;
  senderId: string;
  type: MessageType;
  body: string | null;
  createdAt: string;
  /** Media reference only (never bytes), when the message carries an attachment. */
  attachment?: ChatAttachment | null;
  /** True for the specific message that was reported / is the inspection focus. */
  isReported?: boolean;
}

/**
 * A report resolved with its surrounding context (Req 7.1–7.6). `content` shape
 * depends on `target.kind`; `transcript` is populated for `message` targets;
 * `contentUnavailable` marks removed/purged content instead of failing.
 */
export interface ReportContext {
  report: AdminReport;
  target: {
    kind: 'message' | 'wall_post' | 'wall_reply' | 'community_post' | 'user';
    content: unknown;
    transcript?: TranscriptMessage[];
    contentUnavailable?: boolean;
  };
}

// --- Data_Inspector DTOs (Requirement 8) ---

/** A read-only post/reply record surfaced to the Data_Inspector (Req 8.1). */
export interface InspectedPost {
  id: string;
  kind: 'wall_post' | 'wall_reply' | 'community_post';
  /** Null when the content was authored anonymously. */
  authorId: string | null;
  isAnonymous: boolean;
  body: string | null;
  status: ContentStatus;
  /** Media references attached to the content (never bytes). */
  mediaIds: string[];
  createdAt: string;
  /** True when the record was hard-purged under retention (tombstone, Req 8.6). */
  contentUnavailable?: boolean;
}

/**
 * Read-only media metadata surfaced to the Data_Inspector. Bytes are served
 * only via short-lived signed URLs; no permanent public URL is exposed (Req 8.5).
 */
export interface InspectedMediaMeta {
  id: string;
  kind: MediaKind;
  mimeType: string;
  status: MediaStatus;
  durationMs: number | null;
  /** Null when the owning account has been purged. */
  ownerId: string | null;
  createdAt: string;
  /** True when the asset was hard-purged under retention (tombstone, Req 8.6). */
  contentUnavailable?: boolean;
}

/**
 * The bounded transcript window returned by scoped conversation inspection
 * (Req 8.3). Recorded against the resolving report/investigation in the audit
 * log (Req 8.4).
 */
export interface ConversationTranscript {
  contextType: MessageContextType;
  conversationId: string;
  messages: TranscriptMessage[];
  /** The report this inspection was scoped to, when applicable. */
  reportId: string | null;
  /** True when the conversation was removed/purged (tombstone, Req 8.6). */
  contentUnavailable?: boolean;
}

// --- Socket events (SOCKET_EVENTS.md §11) ---

export const ADMIN_SERVER_EVENTS = {
  USER_SUSPENDED: 'user_suspended',
  ANNOUNCEMENT_BROADCAST: 'announcement_broadcast',
  MAINTENANCE_MODE: 'maintenance_mode',
  FEATURE_TOGGLE: 'feature_toggle',
} as const;
