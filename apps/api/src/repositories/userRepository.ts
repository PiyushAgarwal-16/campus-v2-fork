import { and, eq, ilike, inArray, isNull } from 'drizzle-orm';
import type { AccountStatus } from '@campusly/shared-types';
import { db } from '../db/client.js';
import {
  users,
  googleAccounts,
  profiles,
  privacySettings,
  type UserRow,
  type NewUserRow,
} from '../db/schema.js';

/**
 * Data access for users and their linked Google accounts
 * (DATABASE_SCHEMA.md §5.3–5.4).
 */
export const userRepository = {
  async findById(id: string): Promise<UserRow | null> {
    const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async findByGoogleSub(googleSub: string): Promise<UserRow | null> {
    const rows = await db
      .select({ user: users })
      .from(googleAccounts)
      .innerJoin(users, eq(users.id, googleAccounts.userId))
      .where(eq(googleAccounts.googleSub, googleSub))
      .limit(1);
    return rows[0]?.user ?? null;
  },

  async findByEmail(email: string): Promise<UserRow | null> {
    const rows = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    return rows[0] ?? null;
  },

  /**
   * Creates a user and links their Google account atomically (a verified
   * sign-in always produces exactly one user + one google_accounts row).
   */
  async createWithGoogle(input: {
    user: NewUserRow;
    google: { googleSub: string; email: string; pictureUrl?: string | null };
  }): Promise<UserRow> {
    return db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ ...input.user, email: input.user.email.toLowerCase() })
        .returning();
      if (!created) throw new Error('Failed to create user');
      await tx.insert(googleAccounts).values({
        userId: created.id,
        googleSub: input.google.googleSub,
        email: input.google.email.toLowerCase(),
        pictureUrl: input.google.pictureUrl ?? null,
      });
      // Every user has exactly one profile + privacy_settings row, created with
      // privacy-friendly defaults (DATABASE_SCHEMA.md §6.1, §6.3).
      await tx.insert(profiles).values({ userId: created.id });
      await tx.insert(privacySettings).values({ userId: created.id });
      return created;
    });
  },

  async updateStatus(id: string, status: AccountStatus): Promise<void> {
    await db
      .update(users)
      .set({ accountStatus: status, updatedAt: new Date() })
      .where(eq(users.id, id));
  },

  /** Updates editable/verified core user fields (name, year, branch). */
  async updateCoreFields(
    id: string,
    fields: { name?: string; year?: number | null; branchId?: string | null },
  ): Promise<void> {
    if (Object.keys(fields).length === 0) return;
    await db
      .update(users)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(users.id, id));
  },

  /** Campus-scoped name search of active students (GET /users/search). */
  async searchByName(universityId: string, query: string, limit = 20): Promise<UserRow[]> {
    const term = `%${query.trim().toLowerCase()}%`;
    return db
      .select()
      .from(users)
      .where(
        and(
          eq(users.universityId, universityId),
          eq(users.accountStatus, 'active'),
          isNull(users.deletedAt),
          ilike(users.name, term),
        ),
      )
      .limit(limit);
  },

  /** Soft-deletes the account (deactivation); PII purge runs after the grace window. */
  async softDelete(id: string): Promise<void> {
    await db
      .update(users)
      .set({ accountStatus: 'deactivated', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
  },

  /**
   * Minimal public identity for a set of users (FRIEND_SYSTEM.md §4 — revealed
   * only on consensual friendship). Joins the profile for the avatar reference.
   */
  async getPublicSummaries(
    ids: string[],
  ): Promise<
    Map<
      string,
      {
        id: string;
        name: string;
        universityId: string;
        year: number | null;
        avatarMediaId: string | null;
      }
    >
  > {
    const map = new Map<
      string,
      {
        id: string;
        name: string;
        universityId: string;
        year: number | null;
        avatarMediaId: string | null;
      }
    >();
    if (ids.length === 0) return map;
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        universityId: users.universityId,
        year: users.year,
        avatarMediaId: profiles.avatarMediaId,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(inArray(users.id, ids));
    for (const r of rows) {
      map.set(r.id, {
        id: r.id,
        name: r.name,
        universityId: r.universityId,
        year: r.year,
        avatarMediaId: r.avatarMediaId ?? null,
      });
    }
    return map;
  },
};
