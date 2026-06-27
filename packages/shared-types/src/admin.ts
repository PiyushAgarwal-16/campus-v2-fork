import { z } from 'zod';
import type { UserRole, AccountStatus, SubscriptionStatus } from './auth';
import { REPORT_TARGETS } from './wall';

/**
 * Admin & Moderation contracts (ADMIN_PANEL.md, DATABASE_SCHEMA.md §15, §19,
 * API_SPEC.md §15). All admin endpoints are RBAC-gated server-side. Graduated
 * enforcement: dismiss / warn → restrict → suspend → ban, all audit-logged.
 */

/** Roles allowed into moderation surfaces, and into full admin surfaces. */
export const MODERATOR_ROLES: UserRole[] = ['moderator', 'admin', 'super_admin'];
export const ADMIN_ROLES: UserRole[] = ['admin', 'super_admin'];

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

// --- Socket events (SOCKET_EVENTS.md §11) ---

export const ADMIN_SERVER_EVENTS = {
  USER_SUSPENDED: 'user_suspended',
  ANNOUNCEMENT_BROADCAST: 'announcement_broadcast',
  MAINTENANCE_MODE: 'maintenance_mode',
  FEATURE_TOGGLE: 'feature_toggle',
} as const;
