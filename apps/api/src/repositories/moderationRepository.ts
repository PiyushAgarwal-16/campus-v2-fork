import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { AccountStatus, ModerationActionType } from '@campusly/shared-types';
import { db } from '../db/client.js';
import {
  reports,
  moderationActions,
  userWarnings,
  userBans,
  moderationAppeals,
  auditLogs,
  users,
  wallPosts,
  wallReplies,
  communityPosts,
  type ReportRow,
  type ModerationActionRow,
  type UserBanRow,
  type UserWarningRow,
  type ModerationAppealRow,
  type AuditLogRow,
} from '../db/schema.js';

/**
 * Data access for moderation (DATABASE_SCHEMA.md §15). Actions are append-only
 * and written transactionally with an immutable audit_logs entry.
 */
type ReportTargetType =
  | 'user'
  | 'wall_post'
  | 'wall_reply'
  | 'community_post'
  | 'message'
  | 'marketplace_item'
  | 'lost_found_item';

export const moderationRepository = {
  // --- Reports ---
  async listReports(
    status: string[] | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<ReportRow[]> {
    const conditions = [];
    if (status?.length) conditions.push(inArray(reports.status, status as ReportRow['status'][]));
    if (cursor) conditions.push(lt(reports.createdAt, new Date(cursor)));
    return db
      .select()
      .from(reports)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(reports.createdAt))
      .limit(limit);
  },

  async getReport(id: string): Promise<ReportRow | null> {
    const rows = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async setReportStatus(
    id: string,
    status: 'reviewing' | 'resolved' | 'dismissed',
    resolvedBy?: string,
  ): Promise<void> {
    const resolved = status === 'resolved' || status === 'dismissed';
    await db
      .update(reports)
      .set({ status, resolvedBy: resolvedBy ?? null, resolvedAt: resolved ? new Date() : null })
      .where(eq(reports.id, id));
  },

  async countPendingReports(): Promise<number> {
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(reports)
      .where(inArray(reports.status, ['open', 'reviewing']));
    return rows[0]?.c ?? 0;
  },

  async countReportsAgainst(targetId: string): Promise<number> {
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(reports)
      .where(eq(reports.targetId, targetId));
    return rows[0]?.c ?? 0;
  },

  /**
   * Records a moderation action and its audit-log entry in one transaction,
   * optionally issuing a warning/ban and transitioning the user's status.
   */
  async applyAction(input: {
    moderatorId: string;
    reportId?: string;
    targetType: ReportTargetType;
    targetId: string;
    action: ModerationActionType;
    reason?: string;
    affectedUserId?: string;
    accountStatus?: AccountStatus;
    ban?: { type: 'temporary' | 'permanent'; endsAt: Date | null };
    warningMessage?: string;
  }): Promise<ModerationActionRow> {
    return db.transaction(async (tx) => {
      const [action] = await tx
        .insert(moderationActions)
        .values({
          moderatorId: input.moderatorId,
          reportId: input.reportId ?? null,
          targetType: input.targetType,
          targetId: input.targetId,
          action: input.action,
          reason: input.reason ?? null,
        })
        .returning();
      if (!action) throw new Error('Failed to record action');

      if (input.warningMessage && input.affectedUserId) {
        await tx
          .insert(userWarnings)
          .values({
            userId: input.affectedUserId,
            actionId: action.id,
            message: input.warningMessage,
          });
      }
      if (input.ban && input.affectedUserId) {
        // Deactivate prior active bans, then record the new one.
        await tx
          .update(userBans)
          .set({ isActive: false })
          .where(and(eq(userBans.userId, input.affectedUserId), eq(userBans.isActive, true)));
        await tx.insert(userBans).values({
          userId: input.affectedUserId,
          actionId: action.id,
          type: input.ban.type,
          reason: input.reason ?? null,
          endsAt: input.ban.endsAt,
          isActive: true,
        });
      }
      if (input.accountStatus && input.affectedUserId) {
        await tx
          .update(users)
          .set({ accountStatus: input.accountStatus, updatedAt: new Date() })
          .where(eq(users.id, input.affectedUserId));
      }
      // Content hide/remove transitions the content status.
      if (input.action === 'hide_content' || input.action === 'remove_content') {
        const status = input.action === 'hide_content' ? 'hidden' : 'removed';
        if (input.targetType === 'wall_post') {
          await tx.update(wallPosts).set({ status }).where(eq(wallPosts.id, input.targetId));
        } else if (input.targetType === 'wall_reply') {
          await tx.update(wallReplies).set({ status }).where(eq(wallReplies.id, input.targetId));
        } else if (input.targetType === 'community_post') {
          await tx
            .update(communityPosts)
            .set({ status })
            .where(eq(communityPosts.id, input.targetId));
        }
      }
      if (input.reportId) {
        await tx
          .update(reports)
          .set({ status: 'resolved', resolvedBy: input.moderatorId, resolvedAt: new Date() })
          .where(eq(reports.id, input.reportId));
      }

      await tx.insert(auditLogs).values({
        actorId: input.moderatorId,
        action: `moderation.${input.action}`,
        targetType: input.targetType,
        targetId: input.targetId,
        metadata: { reason: input.reason ?? null, reportId: input.reportId ?? null },
      });
      return action;
    });
  },

  // --- User history ---
  async warningsFor(userId: string): Promise<UserWarningRow[]> {
    return db
      .select()
      .from(userWarnings)
      .where(eq(userWarnings.userId, userId))
      .orderBy(desc(userWarnings.createdAt));
  },

  async bansFor(userId: string): Promise<UserBanRow[]> {
    return db
      .select()
      .from(userBans)
      .where(eq(userBans.userId, userId))
      .orderBy(desc(userBans.createdAt));
  },

  async actionsAgainst(targetId: string): Promise<ModerationActionRow[]> {
    return db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.targetId, targetId))
      .orderBy(desc(moderationActions.createdAt))
      .limit(20);
  },

  async getActionById(id: string): Promise<ModerationActionRow | null> {
    const rows = await db
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.id, id))
      .limit(1);
    return rows[0] ?? null;
  },

  async activeBan(userId: string): Promise<UserBanRow | null> {
    const rows = await db
      .select()
      .from(userBans)
      .where(and(eq(userBans.userId, userId), eq(userBans.isActive, true)))
      .limit(1);
    return rows[0] ?? null;
  },

  async deactivateBans(userId: string): Promise<void> {
    await db
      .update(userBans)
      .set({ isActive: false })
      .where(and(eq(userBans.userId, userId), eq(userBans.isActive, true)));
  },

  /** Expired temporary bans still marked active (for the auto-lift worker). */
  async expiredActiveBans(now: Date): Promise<UserBanRow[]> {
    return db
      .select()
      .from(userBans)
      .where(
        and(eq(userBans.isActive, true), eq(userBans.type, 'temporary'), lt(userBans.endsAt, now)),
      );
  },

  // --- Appeals ---
  async createAppeal(
    userId: string,
    actionId: string,
    message: string,
  ): Promise<ModerationAppealRow> {
    const [row] = await db
      .insert(moderationAppeals)
      .values({ userId, actionId, message })
      .returning();
    if (!row) throw new Error('Failed to file appeal');
    return row;
  },

  async listAppeals(status: string[] | undefined): Promise<ModerationAppealRow[]> {
    return db
      .select()
      .from(moderationAppeals)
      .where(
        status?.length
          ? inArray(moderationAppeals.status, status as ModerationAppealRow['status'][])
          : undefined,
      )
      .orderBy(desc(moderationAppeals.createdAt));
  },

  async getAppeal(id: string): Promise<ModerationAppealRow | null> {
    const rows = await db
      .select()
      .from(moderationAppeals)
      .where(eq(moderationAppeals.id, id))
      .limit(1);
    return rows[0] ?? null;
  },

  async resolveAppeal(
    id: string,
    status: 'upheld' | 'overturned',
    reviewedBy: string,
  ): Promise<void> {
    await db
      .update(moderationAppeals)
      .set({ status, reviewedBy, resolvedAt: new Date() })
      .where(eq(moderationAppeals.id, id));
  },

  // --- Audit logs ---
  async writeAudit(input: {
    actorId: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: unknown;
  }): Promise<void> {
    await db.insert(auditLogs).values({
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: (input.metadata as object) ?? null,
    });
  },

  async listAudit(cursor: string | undefined, limit: number): Promise<AuditLogRow[]> {
    const conditions = cursor ? [lt(auditLogs.createdAt, new Date(cursor))] : [];
    return db
      .select()
      .from(auditLogs)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);
  },
};
