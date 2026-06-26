import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { refreshTokens, type RefreshTokenRow } from '../db/schema.js';

/**
 * Data access for refresh tokens (DATABASE_SCHEMA.md §5.5).
 * Tokens are stored only as hashes; rotation and revocation happen here.
 */
export const refreshTokenRepository = {
  async create(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenRow> {
    const [row] = await db.insert(refreshTokens).values(input).returning();
    if (!row) throw new Error('Failed to create refresh token');
    return row;
  },

  async findActiveByHash(tokenHash: string): Promise<RefreshTokenRow | null> {
    const rows = await db
      .select()
      .from(refreshTokens)
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt)))
      .limit(1);
    return rows[0] ?? null;
  },

  async revokeById(id: string, replacedBy?: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date(), replacedBy: replacedBy ?? null })
      .where(eq(refreshTokens.id, id));
  },

  /** Revokes every active refresh token for a user (logout-all / ban / suspend). */
  async revokeAllForUser(userId: string): Promise<void> {
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  },
};
