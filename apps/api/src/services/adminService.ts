import type {
  AccessTokenClaims,
  AdminReport,
  AdminUser,
  UserHistory,
  DashboardMetrics,
  FeatureFlag,
  Announcement,
  AuditLogItem,
  Appeal,
  ApplyActionInput,
  SetUserStatusInput,
  CreateAnnouncementInput,
  UniversityOption,
  CreateUserInput,
  EditUserInput,
  ChangeRoleInput,
  DeleteUserInput,
  BulkActionInput,
  BulkActionResult,
} from '@campusly/shared-types';
import { ADMIN_SERVER_EVENTS } from '@campusly/shared-types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { hashPassword } from '../lib/crypto.js';
import type {
  UserRow,
  ReportRow,
  FeatureFlagRow,
  AnnouncementRow,
  AuditLogRow,
  ModerationAppealRow,
} from '../db/schema.js';
import { moderationRepository } from '../repositories/moderationRepository.js';
import { adminRepository } from '../repositories/adminRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { universityRepository } from '../repositories/universityRepository.js';
import { wallRepository } from '../repositories/wallRepository.js';
import { communityRepository } from '../repositories/communityRepository.js';
import { refreshTokenRepository } from '../repositories/refreshTokenRepository.js';
import { subscriptionService } from './subscriptionService.js';
import { notifier } from '../realtime/notifier.js';
import { logger } from '../config/logger.js';

/**
 * Admin & moderation business logic (ADMIN_PANEL.md). RBAC is enforced at the
 * route layer; this layer performs graduated enforcement, immutable audit
 * logging, and session teardown for suspensions/bans.
 */

const SWEEP_INTERVAL_MS = 60_000;

/**
 * Bulk-action variants that are destructive/irreversible and therefore require
 * an explicit confirmation token before execution (Req 11.4, 12.2). `restrict`
 * is reversible and is intentionally excluded.
 */
const DESTRUCTIVE_BULK_ACTIONS: ReadonlySet<BulkActionInput['action']> = new Set([
  'ban',
  'delete',
  'revoke_subscription',
]);

type ReportTargetType = ApplyActionInput['targetType'];

/** Default feature flags (ADMIN_PANEL.md §10), enabled so the product runs free. */
export const DEFAULT_FEATURE_FLAGS = [
  { key: 'anonymous_matching', description: 'Anonymous matching surface', isEnabled: true },
  { key: 'campus_wall', description: 'Campus wall', isEnabled: true },
  { key: 'friend_system', description: 'Friend system', isEnabled: true },
  { key: 'voice_messages', description: 'Voice messages', isEnabled: true },
  { key: 'media_uploads', description: 'Media uploads', isEnabled: true },
  { key: 'communities', description: 'Communities & clubs', isEnabled: true },
  { key: 'maintenance_mode', description: 'Platform maintenance mode', isEnabled: false },
  {
    key: 'subscription_required',
    description: 'Require premium for gated features',
    isEnabled: false,
  },
];

class AdminService {
  private sweeper: NodeJS.Timeout | null = null;

  // --- Dashboard ---
  /**
   * Dashboard metrics (Req 10.1). Each metric group is computed independently
   * and defended so a single failing aggregate returns a defined `0` fallback
   * instead of collapsing the whole dashboard response (Req 10.4, Property 22).
   * `dashboardCounts` is the lightweight aggregate query (Req 10.3); the pending
   * report count is a separate query and is isolated from it.
   */
  async dashboard(): Promise<DashboardMetrics> {
    const zeroCounts = {
      totalUsers: 0,
      activeUsers: 0,
      postsToday: 0,
      communities: 0,
      premiumUsers: 0,
    };
    const [counts, pendingReports] = await Promise.all([
      this.safeMetric('dashboardCounts', () => adminRepository.dashboardCounts(), zeroCounts),
      this.safeMetric('pendingReports', () => moderationRepository.countPendingReports(), 0),
    ]);
    return { ...counts, pendingReports };
  }

  /**
   * Runs a single dashboard metric computation, returning `fallback` (a defined
   * zero/unavailable value) if it rejects so one failing metric never fails the
   * whole dashboard (Req 10.4). The failure is logged for operability.
   */
  private async safeMetric<T>(name: string, compute: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await compute();
    } catch (err) {
      logger.error({ err, metric: name }, 'dashboard metric failed; returning fallback');
      return fallback;
    }
  }

  // --- Reports ---
  async reportQueue(
    status: string[] | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ reports: AdminReport[]; nextCursor: string | null }> {
    const rows = await moderationRepository.listReports(
      status ?? ['open', 'reviewing'],
      cursor,
      limit,
    );
    const nextCursor =
      rows.length === limit ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null;
    return { reports: rows.map(toAdminReport), nextCursor };
  }

  async resolveReport(
    claims: AccessTokenClaims,
    id: string,
    status: 'reviewing' | 'resolved' | 'dismissed',
  ): Promise<void> {
    const report = await moderationRepository.getReport(id);
    if (!report) throw new NotFoundError('Report not found.');
    await moderationRepository.setReportStatus(
      id,
      status,
      status === 'reviewing' ? undefined : claims.sub,
    );
    await moderationRepository.writeAudit({
      actorId: claims.sub,
      action: `report.${status}`,
      targetType: report.targetType,
      targetId: report.targetId,
      metadata: { reportId: id },
    });
  }

  // --- Moderation actions (graduated enforcement) ---
  async applyAction(claims: AccessTokenClaims, input: ApplyActionInput): Promise<void> {
    const affectedUserId = await this.resolveAffectedUser(input.targetType, input.targetId);

    let accountStatus: AdminUser['accountStatus'] | undefined;
    let ban: { type: 'temporary' | 'permanent'; endsAt: Date | null } | undefined;
    let warningMessage: string | undefined;

    if (input.action === 'warn') {
      warningMessage = input.reason ?? 'Please review the community guidelines.';
    } else if (input.action === 'restrict') {
      accountStatus = 'restricted';
      const endsAt = input.durationHours
        ? new Date(Date.now() + input.durationHours * 3600_000)
        : null;
      ban = { type: endsAt ? 'temporary' : 'permanent', endsAt };
    } else if (input.action === 'ban') {
      if (input.durationHours) {
        accountStatus = 'suspended';
        ban = { type: 'temporary', endsAt: new Date(Date.now() + input.durationHours * 3600_000) };
      } else {
        accountStatus = 'banned';
        ban = { type: 'permanent', endsAt: null };
      }
    }

    await moderationRepository.applyAction({
      moderatorId: claims.sub,
      reportId: input.reportId,
      targetType: input.targetType,
      targetId: input.targetId,
      action: input.action,
      reason: input.reason,
      affectedUserId: affectedUserId ?? undefined,
      accountStatus,
      ban,
      warningMessage,
    });

    if (input.action === 'dismiss' && input.reportId) {
      await moderationRepository.setReportStatus(input.reportId, 'dismissed', claims.sub);
    }

    // Suspensions/bans force an immediate session teardown.
    if (affectedUserId && (accountStatus === 'suspended' || accountStatus === 'banned')) {
      await this.teardownSessions(affectedUserId);
    }
  }

  // --- User management ---
  async listUsers(
    q: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ users: AdminUser[]; nextCursor: string | null }> {
    const rows = await adminRepository.listUsers(q, cursor, limit);
    const nextCursor =
      rows.length === limit ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null;
    return { users: rows.map(toAdminUser), nextCursor };
  }

  async userHistory(userId: string): Promise<UserHistory> {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found.');
    const [warnings, bans, actions, reportsAgainst] = await Promise.all([
      moderationRepository.warningsFor(userId),
      moderationRepository.bansFor(userId),
      moderationRepository.actionsAgainst(userId),
      moderationRepository.countReportsAgainst(userId),
    ]);
    return {
      user: toAdminUser(user),
      warnings: warnings.map((w) => ({
        id: w.id,
        message: w.message,
        createdAt: w.createdAt.toISOString(),
      })),
      bans: bans.map((b) => ({
        id: b.id,
        type: b.type,
        reason: b.reason,
        startsAt: b.startsAt.toISOString(),
        endsAt: b.endsAt ? b.endsAt.toISOString() : null,
        isActive: b.isActive,
      })),
      recentActions: actions.map((a) => ({
        id: a.id,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
      reportsAgainst,
    };
  }

  async setUserStatus(
    claims: AccessTokenClaims,
    userId: string,
    input: SetUserStatusInput,
  ): Promise<void> {
    // Generalized target protection: rejects a missing user (NotFoundError) or a
    // super_admin target (ForbiddenError), shared by status change, role change,
    // and soft delete (Req 5.6).
    await this.requireModifiableTarget(userId);

    if (input.status === 'active') {
      // Restore: lift active bans and reactivate.
      await moderationRepository.deactivateBans(userId);
      await userRepository.updateStatus(userId, 'active');
    } else {
      const isBan = input.status === 'suspended' || input.status === 'banned';
      const endsAt =
        input.status === 'suspended' && input.durationHours
          ? new Date(Date.now() + input.durationHours * 3600_000)
          : null;
      await moderationRepository.applyAction({
        moderatorId: claims.sub,
        targetType: 'user',
        targetId: userId,
        action:
          input.status === 'banned' ? 'ban' : input.status === 'suspended' ? 'ban' : 'restrict',
        reason: input.reason,
        affectedUserId: userId,
        accountStatus: input.status,
        ban: isBan
          ? { type: input.status === 'banned' ? 'permanent' : 'temporary', endsAt }
          : { type: endsAt ? 'temporary' : 'permanent', endsAt },
      });
      if (isBan) await this.teardownSessions(userId);
    }
    await moderationRepository.writeAudit({
      actorId: claims.sub,
      action: `user.status.${input.status}`,
      targetType: 'user',
      targetId: userId,
    });
  }

  // --- User lifecycle: manual create, edit, role change, soft delete (Req 4, 5) ---

  /**
   * Manual user creation with full admin authority (Req 4). Creates an ACTIVE
   * `role='student'` account with an admin-set email + password — the account can
   * sign in directly, no Google verification required. The target university must
   * exist and the email must be unique; both are validated BEFORE any write so a
   * rejected request creates nothing. The repository writes the
   * `user.create_manual` audit entry (`source='admin_manual'`).
   */
  /** Active campuses for the admin user-creation picker. */
  async listUniversities(): Promise<UniversityOption[]> {
    const rows = await universityRepository.listActive();
    return rows.map((u) => ({ id: u.id, name: u.name, shortName: u.shortName }));
  }

  async createUser(claims: AccessTokenClaims, input: CreateUserInput): Promise<AdminUser> {
    const email = input.email.trim().toLowerCase();

    // The target campus must exist (campus scoping). Admin-created email+password
    // accounts are NOT restricted to the campus's Google domains.
    const domains = await adminRepository.getUniversityEmailDomains(input.universityId);
    if (!domains) throw new ValidationError('University not found.');

    // Duplicate pre-check (Req 4.3); the unique constraint is the backstop.
    const existing = await adminRepository.findUserByEmail(email);
    if (existing) throw new ConflictError('An account with that email already exists.');

    const passwordHash = await hashPassword(input.password);
    const created = await adminRepository.createManualUser({
      name: input.name,
      email,
      universityId: input.universityId,
      passwordHash,
      actorId: claims.sub,
    });
    return toAdminUser(created);
  }

  /**
   * Edit a user's permitted profile fields (Req 5.3). Verified fields are absent
   * from `EditUserInput` by schema; as defense-in-depth we still reject a raw
   * payload that smuggles `universityId`/`branchId`/`year` (Req 5.4) before any
   * write. The repository persists name/bio/avatar and writes the `user.edit`
   * audit entry.
   */
  async editUser(
    claims: AccessTokenClaims,
    userId: string,
    input: EditUserInput,
  ): Promise<AdminUser> {
    await this.requireExistingUser(userId);

    // Defense-in-depth: reject any attempt to mutate immutable verified fields
    // even if they somehow bypass the schema (Req 5.4).
    const raw = input as Record<string, unknown>;
    if ('universityId' in raw || 'branchId' in raw || 'year' in raw) {
      throw new ValidationError('Verified fields cannot be edited.');
    }

    await adminRepository.updateEditableFields({
      userId,
      fields: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.bio !== undefined ? { bio: input.bio } : {}),
        ...(input.avatarMediaId !== undefined ? { avatarMediaId: input.avatarMediaId } : {}),
      },
      actorId: claims.sub,
    });

    const updated = await userRepository.findById(userId);
    if (!updated) throw new NotFoundError('User not found.');
    return toAdminUser(updated);
  }

  /**
   * Change a user's role (Req 5.5). Rejects a missing or `super_admin` target
   * (Req 5.6); the route layer enforces Super Admin authorization. The
   * repository records the `{ from, to }` transition in a `user.role_change`
   * audit entry.
   */
  async changeRole(
    claims: AccessTokenClaims,
    userId: string,
    input: ChangeRoleInput,
  ): Promise<AdminUser> {
    await this.requireModifiableTarget(userId);
    await adminRepository.changeRole({
      userId,
      newRole: input.role,
      reason: input.reason,
      actorId: claims.sub,
    });
    const updated = await userRepository.findById(userId);
    if (!updated) throw new NotFoundError('User not found.');
    return toAdminUser(updated);
  }

  /**
   * Soft-delete a user (Req 5.7). Rejects a missing or `super_admin` target
   * (Req 5.6), then stamps `deleted_at` (+ `user.delete` audit) via the
   * repository and performs Session_Teardown so the account is immediately
   * logged out. PII purge is owned by the existing grace-window deletion job.
   */
  async softDelete(
    claims: AccessTokenClaims,
    userId: string,
    input: DeleteUserInput,
  ): Promise<void> {
    await this.requireModifiableTarget(userId);
    await adminRepository.softDelete({ userId, reason: input.reason, actorId: claims.sub });

    // Session_Teardown: revoke refresh tokens + signal disconnect (Req 5.7,
    // AUTH_SYSTEM.md §6). Reuses the same path as suspend/ban.
    await this.teardownSessions(userId);

    // PII purge: the account is soft-deleted (deleted_at stamped) now; the hard
    // PII purge runs after ACCOUNT_DELETION_GRACE_DAYS via the existing
    // account-deletion background job (AUTH_SYSTEM.md §8; see
    // authService.deleteAccount). No new purge subsystem is introduced here.
    // TODO(purge): when the retention/purge job is built (Phase 12+), ensure it
    // also sweeps admin-initiated soft deletes stamped by this path.
  }

  // --- Bulk actions (Req 11, 12) ---

  /**
   * Apply an action to up to 100 targets independently (Req 11). Destructive
   * variants (`ban`, `delete`, `revoke_subscription`) require explicit
   * confirmation, validated BEFORE any target is touched (Req 11.4, 12.2). Each
   * target is applied in isolation: a failure on one target is captured as an
   * `ok:false` result and never aborts the batch (Req 11.3). Each successful
   * target produces exactly one audit entry, written by the underlying
   * single-target operation — no double-write here (Req 11.1).
   */
  async bulkAction(claims: AccessTokenClaims, input: BulkActionInput): Promise<BulkActionResult[]> {
    if (DESTRUCTIVE_BULK_ACTIONS.has(input.action) && input.confirm !== true) {
      throw new ValidationError(
        'This bulk action is destructive and requires explicit confirmation.',
      );
    }

    const results: BulkActionResult[] = [];
    for (const targetId of input.targetIds) {
      try {
        await this.applyBulkTarget(claims, input, targetId);
        results.push({ targetId, ok: true, error: null });
      } catch (err) {
        results.push({
          targetId,
          ok: false,
          error: err instanceof Error ? err.message : 'Action failed.',
        });
      }
    }
    return results;
  }

  /**
   * Applies a single bulk-action target by delegating to the existing
   * single-target operation, each of which writes its own audit entry and
   * enforces super_admin/target protection. Throwing here isolates the failure
   * to this target's result entry.
   */
  private async applyBulkTarget(
    claims: AccessTokenClaims,
    input: BulkActionInput,
    targetId: string,
  ): Promise<void> {
    switch (input.action) {
      case 'restrict':
        await this.setUserStatus(claims, targetId, {
          status: 'restricted',
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        });
        return;
      case 'ban':
        // No duration → permanent ban (a destructive variant, confirm-gated above).
        await this.setUserStatus(claims, targetId, {
          status: 'banned',
          ...(input.reason !== undefined ? { reason: input.reason } : {}),
        });
        return;
      case 'delete':
        await this.softDelete(claims, targetId, {
          confirm: true,
          reason: input.reason ?? 'Bulk delete.',
        });
        return;
      case 'revoke_subscription':
        // Guard super_admin targets here (revoke has no target protection of its
        // own) so they fail this result entry rather than aborting the batch.
        await this.requireModifiableTarget(targetId);
        await subscriptionService.revoke(
          claims,
          targetId,
          input.reason !== undefined ? { reason: input.reason } : {},
        );
        return;
    }
  }

  // --- Appeals ---
  async fileAppeal(claims: AccessTokenClaims, actionId: string, message: string): Promise<Appeal> {
    const action = await moderationRepository.getActionById(actionId);
    if (!action) throw new NotFoundError('Action not found.');
    const affected = await this.resolveAffectedUser(action.targetType, action.targetId);
    if (affected !== claims.sub && action.targetId !== claims.sub) {
      throw new ForbiddenError('You can only appeal actions against you.');
    }
    const row = await moderationRepository.createAppeal(claims.sub, actionId, message);
    return toAppeal(row);
  }

  async listAppeals(status: string[] | undefined): Promise<Appeal[]> {
    const rows = await moderationRepository.listAppeals(status ?? ['pending']);
    return rows.map(toAppeal);
  }

  async resolveAppeal(
    claims: AccessTokenClaims,
    id: string,
    status: 'upheld' | 'overturned',
  ): Promise<void> {
    const appeal = await moderationRepository.getAppeal(id);
    if (!appeal || appeal.status !== 'pending') throw new NotFoundError('Appeal not found.');
    await moderationRepository.resolveAppeal(id, status, claims.sub);
    if (status === 'overturned') {
      // Reverse the penalty: lift bans and restore the user.
      await moderationRepository.deactivateBans(appeal.userId);
      await userRepository.updateStatus(appeal.userId, 'active');
    }
    await moderationRepository.writeAudit({
      actorId: claims.sub,
      action: `appeal.${status}`,
      targetType: 'user',
      targetId: appeal.userId,
      metadata: { appealId: id },
    });
  }

  // --- Feature flags ---
  async listFlags(): Promise<FeatureFlag[]> {
    const rows = await adminRepository.listFlags();
    return rows.map(toFlag);
  }

  async setFlag(claims: AccessTokenClaims, key: string, isEnabled: boolean): Promise<FeatureFlag> {
    const flag = await adminRepository.getFlag(key);
    if (!flag) throw new NotFoundError('Feature flag not found.');
    await adminRepository.setFlag(key, isEnabled);
    await moderationRepository.writeAudit({
      actorId: claims.sub,
      action: 'feature_flag.toggle',
      targetType: 'feature_flag',
      metadata: { key, isEnabled },
    });
    notifier.broadcast(ADMIN_SERVER_EVENTS.FEATURE_TOGGLE, { key, isEnabled });
    return { key, isEnabled, description: flag.description };
  }

  // --- Announcements ---
  async createAnnouncement(
    claims: AccessTokenClaims,
    input: CreateAnnouncementInput,
  ): Promise<Announcement> {
    if (input.audience === 'campus' && !input.campusScoped) {
      throw new ValidationError('Campus audience requires campusScoped.');
    }
    const row = await adminRepository.createAnnouncement({
      universityId: input.campusScoped ? claims.universityId : null,
      title: input.title,
      body: input.body,
      audience: input.audience,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      createdBy: claims.sub,
    });
    await moderationRepository.writeAudit({
      actorId: claims.sub,
      action: 'announcement.create',
      targetType: 'announcement',
      targetId: row.id,
    });
    const dto = toAnnouncement(row);
    if (input.campusScoped) {
      notifier.emitToRoom(
        `campus:${claims.universityId}`,
        ADMIN_SERVER_EVENTS.ANNOUNCEMENT_BROADCAST,
        {
          announcement: dto,
        },
      );
    } else {
      notifier.broadcast(ADMIN_SERVER_EVENTS.ANNOUNCEMENT_BROADCAST, { announcement: dto });
    }
    return dto;
  }

  async listAnnouncements(): Promise<Announcement[]> {
    const rows = await adminRepository.listAnnouncements();
    return rows.map(toAnnouncement);
  }

  // --- Audit logs ---
  async auditLogs(
    cursor: string | undefined,
    limit: number,
  ): Promise<{ logs: AuditLogItem[]; nextCursor: string | null }> {
    const rows = await moderationRepository.listAudit(cursor, limit);
    const nextCursor =
      rows.length === limit ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null;
    return { logs: rows.map(toAuditItem), nextCursor };
  }

  // --- internal ---

  /** Loads a user, throwing `NotFoundError` when it does not exist. */
  private async requireExistingUser(userId: string): Promise<UserRow> {
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found.');
    return user;
  }

  /**
   * Loads a user and asserts it is a permissible target for a restricted
   * lifecycle op (status change, role change, soft delete): rejects a missing
   * user (NotFoundError) or a `super_admin` target (ForbiddenError) — the
   * generalized super_admin protection required by Req 5.6.
   */
  private async requireModifiableTarget(userId: string): Promise<UserRow> {
    const user = await this.requireExistingUser(userId);
    if (user.role === 'super_admin') throw new ForbiddenError('Cannot moderate a super admin.');
    return user;
  }

  private async resolveAffectedUser(
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<string | null> {
    if (targetType === 'user') return targetId;
    if (targetType === 'wall_post')
      return (await wallRepository.getPostById(targetId))?.authorId ?? null;
    if (targetType === 'wall_reply')
      return (await wallRepository.getReplyById(targetId))?.authorId ?? null;
    if (targetType === 'community_post')
      return (await communityRepository.getPostById(targetId))?.authorId ?? null;
    return null;
  }

  private async teardownSessions(userId: string): Promise<void> {
    await refreshTokenRepository.revokeAllForUser(userId);
    notifier.emitToUser(userId, ADMIN_SERVER_EVENTS.USER_SUSPENDED, {});
  }

  /** Auto-lift expired temporary bans (ADMIN_PANEL.md §5; DATABASE_SCHEMA.md §15.4). */
  startBanSweeper(): void {
    if (this.sweeper) return;
    const run = async () => {
      const expired = await moderationRepository.expiredActiveBans(new Date());
      for (const ban of expired) {
        await moderationRepository.deactivateBans(ban.userId);
        const user = await userRepository.findById(ban.userId);
        if (user && (user.accountStatus === 'suspended' || user.accountStatus === 'restricted')) {
          await userRepository.updateStatus(ban.userId, 'active');
          await moderationRepository.writeAudit({
            actorId: null,
            action: 'ban.auto_lift',
            targetType: 'user',
            targetId: ban.userId,
          });
        }
      }
      if (expired.length) logger.info({ lifted: expired.length }, 'Auto-lifted expired bans');
    };
    this.sweeper = setInterval(
      () => void run().catch((err) => logger.error({ err }, 'ban sweep failed')),
      SWEEP_INTERVAL_MS,
    );
    this.sweeper.unref?.();
  }

  /** Stop the ban sweeper (graceful shutdown). Idempotent. */
  stopBanSweeper(): void {
    if (!this.sweeper) return;
    clearInterval(this.sweeper);
    this.sweeper = null;
  }
}

export const adminService = new AdminService();

// --- mappers ---
function toAdminReport(r: ReportRow): AdminReport {
  return {
    id: r.id,
    reporterId: r.reporterId,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}
function toAdminUser(u: UserRow): AdminUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    accountStatus: u.accountStatus,
    subscriptionStatus: u.subscriptionStatus,
    universityId: u.universityId,
    createdAt: u.createdAt.toISOString(),
  };
}
function toFlag(f: FeatureFlagRow): FeatureFlag {
  return { key: f.key, isEnabled: f.isEnabled, description: f.description };
}
function toAnnouncement(a: AnnouncementRow): Announcement {
  return {
    id: a.id,
    universityId: a.universityId,
    title: a.title,
    body: a.body,
    audience: a.audience,
    startsAt: a.startsAt ? a.startsAt.toISOString() : null,
    endsAt: a.endsAt ? a.endsAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}
function toAuditItem(l: AuditLogRow): AuditLogItem {
  return {
    id: l.id,
    actorId: l.actorId,
    action: l.action,
    targetType: l.targetType,
    targetId: l.targetId,
    createdAt: l.createdAt.toISOString(),
  };
}
function toAppeal(a: ModerationAppealRow): Appeal {
  return {
    id: a.id,
    userId: a.userId,
    actionId: a.actionId,
    message: a.message,
    status: a.status,
    createdAt: a.createdAt.toISOString(),
  };
}
