import { and, desc, eq, gte, ilike, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { AnnouncementAudience, UserRole } from '@campusly/shared-types';
import { db } from '../db/client.js';
import {
  users,
  profiles,
  privacySettings,
  universities,
  auditLogs,
  communities,
  wallPosts,
  featureFlags,
  announcements,
  type UserRow,
  type FeatureFlagRow,
  type AnnouncementRow,
} from '../db/schema.js';
import { userRepository } from './userRepository.js';

/**
 * Data access for admin surfaces (DATABASE_SCHEMA.md §19): feature flags,
 * announcements, user administration, and lightweight dashboard counts.
 */
export const adminRepository = {
  // --- Users ---
  async listUsers(
    q: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<UserRow[]> {
    const conditions = [];
    if (q) {
      const term = `%${q.trim().toLowerCase()}%`;
      conditions.push(or(ilike(users.name, term), ilike(users.email, term)));
    }
    if (cursor) conditions.push(lt(users.createdAt, new Date(cursor)));
    return db
      .select()
      .from(users)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(users.createdAt))
      .limit(limit);
  },

  // --- User lifecycle (Requirements 4, 5) ---
  // Each mutation writes exactly one audit_logs entry for the affected user in
  // the same transaction, mirroring moderationRepository.applyAction.

  /**
   * Manual user creation (Req 4.4/4.5, admin full-authority). Inserts an ACTIVE,
   * `role = 'student'` account with an admin-set password hash — the account can
   * sign in directly with email + password, no Google link required. Also creates
   * the user's profile + privacy_settings rows (as the Google path does) so the
   * account is immediately usable. Relies on `uq_users_email` as the duplicate
   * backstop.
   */
  async createManualUser(input: {
    name: string;
    email: string;
    universityId: string;
    passwordHash: string;
    actorId: string;
  }): Promise<UserRow> {
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          name: input.name,
          email: input.email.toLowerCase(),
          universityId: input.universityId,
          role: 'student',
          accountStatus: 'active',
          passwordHash: input.passwordHash,
        })
        .returning();
      if (!created) throw new Error('Failed to create user');
      // Every user has exactly one profile + privacy_settings row (mirrors the
      // Google sign-up path) so the active account is immediately usable.
      await tx.insert(profiles).values({ userId: created.id });
      await tx.insert(privacySettings).values({ userId: created.id });
      await tx.insert(auditLogs).values({
        actorId: input.actorId,
        action: 'user.create_manual',
        targetType: 'user',
        targetId: created.id,
        metadata: { source: 'admin_manual', authMethod: 'email_password' },
      });
      return created;
    });
  },

  /**
   * Persists only the editable identity fields (Req 5.3): `name` on `users`,
   * `bio`/`avatarMediaId` on `profiles`. Verified fields (university/branch/
   * year) are intentionally not accepted here — that rejection is enforced in
   * the service. A `user.edit` audit entry is written in the same transaction.
   */
  async updateEditableFields(input: {
    userId: string;
    fields: { name?: string; bio?: string; avatarMediaId?: string | null };
    actorId: string;
  }): Promise<void> {
    const { userId, fields, actorId } = input;
    await db.transaction(async (tx) => {
      if (fields.name !== undefined) {
        await tx
          .update(users)
          .set({ name: fields.name, updatedAt: new Date() })
          .where(eq(users.id, userId));
      }
      const profilePatch: { bio?: string; avatarMediaId?: string | null } = {};
      if (fields.bio !== undefined) profilePatch.bio = fields.bio;
      if (fields.avatarMediaId !== undefined) profilePatch.avatarMediaId = fields.avatarMediaId;
      if (Object.keys(profilePatch).length > 0) {
        await tx
          .update(profiles)
          .set({ ...profilePatch, updatedAt: new Date() })
          .where(eq(profiles.userId, userId));
      }
      await tx.insert(auditLogs).values({
        actorId,
        action: 'user.edit',
        targetType: 'user',
        targetId: userId,
        metadata: { fields: Object.keys({ ...fields }) },
      });
    });
  },

  /**
   * Changes a user's role (Req 5.5) and records the transition. The prior role
   * is read inside the transaction so the `user.role_change` audit captures an
   * accurate `{ from, to }` metadata pair.
   */
  async changeRole(input: {
    userId: string;
    newRole: UserRole;
    reason: string;
    actorId: string;
  }): Promise<void> {
    const { userId, newRole, reason, actorId } = input;
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ role: users.role })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!current) throw new Error('User not found');
      await tx
        .update(users)
        .set({ role: newRole, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await tx.insert(auditLogs).values({
        actorId,
        action: 'user.role_change',
        targetType: 'user',
        targetId: userId,
        metadata: { from: current.role, to: newRole, reason },
      });
    });
  },

  /**
   * Soft-deletes a user (Req 5.7) by stamping `deleted_at`. Session teardown
   * and PII-purge scheduling are orchestrated by the service; this repo only
   * performs the soft delete and its `user.delete` audit entry.
   */
  async softDelete(input: { userId: string; reason: string; actorId: string }): Promise<void> {
    const { userId, reason, actorId } = input;
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, userId));
      await tx.insert(auditLogs).values({
        actorId,
        action: 'user.delete',
        targetType: 'user',
        targetId: userId,
        metadata: { reason },
      });
    });
  },

  // --- Manual-create validation lookups ---

  /**
   * Finds a user by email (duplicate pre-check for manual creation, Req 4.3).
   * Delegates to `userRepository.findByEmail` to avoid duplicating the query.
   */
  async findUserByEmail(email: string): Promise<UserRow | null> {
    return userRepository.findByEmail(email);
  },

  /**
   * Returns the verified institutional email domains for a university, used to
   * validate that a manually created user's email belongs to that campus
   * (Req 4.1). Returns null when the university does not exist.
   */
  async getUniversityEmailDomains(universityId: string): Promise<string[] | null> {
    const rows = await db
      .select({ emailDomains: universities.emailDomains })
      .from(universities)
      .where(eq(universities.id, universityId))
      .limit(1);
    return rows[0]?.emailDomains ?? null;
  },

  // --- Dashboard counts (lightweight; analytics aggregates are §18 future) ---
  async dashboardCounts(): Promise<{
    totalUsers: number;
    activeUsers: number;
    postsToday: number;
    communities: number;
    premiumUsers: number;
  }> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const [u] = await db.select({ c: sql<number>`count(*)::int` }).from(users);
    const [a] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.accountStatus, 'active'));
    const [p] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(wallPosts)
      .where(gte(wallPosts.createdAt, startOfDay));
    const [c] = await db.select({ c: sql<number>`count(*)::int` }).from(communities);
    const [prem] = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(users)
      .where(eq(users.subscriptionStatus, 'premium'));
    return {
      totalUsers: u?.c ?? 0,
      activeUsers: a?.c ?? 0,
      postsToday: p?.c ?? 0,
      communities: c?.c ?? 0,
      premiumUsers: prem?.c ?? 0,
    };
  },

  // --- Feature flags ---
  async listFlags(): Promise<FeatureFlagRow[]> {
    return db.select().from(featureFlags).orderBy(featureFlags.key);
  },

  async getFlag(key: string): Promise<FeatureFlagRow | null> {
    const rows = await db.select().from(featureFlags).where(eq(featureFlags.key, key)).limit(1);
    return rows[0] ?? null;
  },

  async setFlag(key: string, isEnabled: boolean): Promise<void> {
    await db
      .update(featureFlags)
      .set({ isEnabled, updatedAt: new Date() })
      .where(eq(featureFlags.key, key));
  },

  async ensureFlags(
    defaults: { key: string; description: string; isEnabled: boolean }[],
  ): Promise<void> {
    for (const f of defaults) {
      await db
        .insert(featureFlags)
        .values({ key: f.key, description: f.description, isEnabled: f.isEnabled })
        .onConflictDoNothing();
    }
  },

  // --- Announcements ---
  async createAnnouncement(input: {
    universityId: string | null;
    title: string;
    body: string;
    audience: AnnouncementAudience;
    startsAt: Date | null;
    endsAt: Date | null;
    createdBy: string;
  }): Promise<AnnouncementRow> {
    const [row] = await db.insert(announcements).values(input).returning();
    if (!row) throw new Error('Failed to create announcement');
    return row;
  },

  async listAnnouncements(limit = 50): Promise<AnnouncementRow[]> {
    return db.select().from(announcements).orderBy(desc(announcements.createdAt)).limit(limit);
  },

  /**
   * Active announcements visible to a student on a given campus (ADMIN_PANEL.md §9):
   * global (universityId null) or campus-scoped to their university, currently
   * within any start/end window, excluding admin-only announcements. Newest first.
   */
  async listActiveAnnouncements(input: {
    universityId: string;
    now: Date;
    limit?: number;
  }): Promise<AnnouncementRow[]> {
    const { universityId, now, limit = 10 } = input;
    return db
      .select()
      .from(announcements)
      .where(
        and(
          ne(announcements.audience, 'admins'),
          or(isNull(announcements.universityId), eq(announcements.universityId, universityId)),
          or(isNull(announcements.startsAt), lte(announcements.startsAt, now)),
          or(isNull(announcements.endsAt), gte(announcements.endsAt, now)),
        ),
      )
      .orderBy(desc(announcements.createdAt))
      .limit(limit);
  },
};
