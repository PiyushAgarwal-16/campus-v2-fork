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
} from '@campusly/shared-types';
import { ADMIN_SERVER_EVENTS } from '@campusly/shared-types';
import { ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
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
import { wallRepository } from '../repositories/wallRepository.js';
import { communityRepository } from '../repositories/communityRepository.js';
import { refreshTokenRepository } from '../repositories/refreshTokenRepository.js';
import { notifier } from '../realtime/notifier.js';
import { logger } from '../config/logger.js';

/**
 * Admin & moderation business logic (ADMIN_PANEL.md). RBAC is enforced at the
 * route layer; this layer performs graduated enforcement, immutable audit
 * logging, and session teardown for suspensions/bans.
 */

const SWEEP_INTERVAL_MS = 60_000;

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
  async dashboard(): Promise<DashboardMetrics> {
    const [counts, pendingReports] = await Promise.all([
      adminRepository.dashboardCounts(),
      moderationRepository.countPendingReports(),
    ]);
    return { ...counts, pendingReports };
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
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User not found.');
    if (user.role === 'super_admin') throw new ForbiddenError('Cannot moderate a super admin.');

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
