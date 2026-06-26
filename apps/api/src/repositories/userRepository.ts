import { eq } from 'drizzle-orm';
import type { AccountStatus } from '@campusly/shared-types';
import { db } from '../db/client.js';
import { users, googleAccounts, type UserRow, type NewUserRow } from '../db/schema.js';

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
      return created;
    });
  },

  async updateStatus(id: string, status: AccountStatus): Promise<void> {
    await db
      .update(users)
      .set({ accountStatus: status, updatedAt: new Date() })
      .where(eq(users.id, id));
  },

  /** Soft-deletes the account (deactivation); PII purge runs after the grace window. */
  async softDelete(id: string): Promise<void> {
    await db
      .update(users)
      .set({ accountStatus: 'deactivated', deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, id));
  },
};
