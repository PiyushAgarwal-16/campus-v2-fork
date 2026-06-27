import { and, eq, lt, or, sql, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  matchQueue,
  anonSessions,
  sessionParticipants,
  matchHistory,
  type AnonSessionRow,
} from '../db/schema.js';

/**
 * Data access for the matching module (DATABASE_SCHEMA.md §7).
 * The in-memory waiting pool (matchingService) is the live authority; these
 * persisted rows exist for durability, recovery, history, and cleanup.
 */
export const matchingRepository = {
  /** Persists/refreshes a user's waiting queue row (one row per user). */
  async upsertWaiting(userId: string, universityId: string): Promise<void> {
    await db
      .insert(matchQueue)
      .values({ userId, universityId, status: 'waiting', lastHeartbeatAt: new Date() })
      .onConflictDoUpdate({
        target: matchQueue.userId,
        set: { status: 'waiting', universityId, lastHeartbeatAt: new Date() },
      });
  },

  async removeFromQueue(userId: string): Promise<void> {
    await db.delete(matchQueue).where(eq(matchQueue.userId, userId));
  },

  async touchHeartbeat(userId: string): Promise<void> {
    await db
      .update(matchQueue)
      .set({ lastHeartbeatAt: new Date() })
      .where(eq(matchQueue.userId, userId));
  },

  /**
   * Creates a session + two participant rows and clears both users' queue rows
   * in ONE transaction (MATCHING_ENGINE.md §5 — no ghost/duplicate sessions).
   */
  async createSession(universityId: string, userA: string, userB: string): Promise<AnonSessionRow> {
    return db.transaction(async (tx) => {
      const [session] = await tx.insert(anonSessions).values({ universityId }).returning();
      if (!session) throw new Error('Failed to create session');
      await tx.insert(sessionParticipants).values([
        { sessionId: session.id, userId: userA },
        { sessionId: session.id, userId: userB },
      ]);
      await tx.delete(matchQueue).where(inArray(matchQueue.userId, [userA, userB]));
      return session;
    });
  },

  /** The active session a user currently participates in, if any. */
  async getActiveSessionForUser(
    userId: string,
  ): Promise<{ sessionId: string; startedAt: Date } | null> {
    const rows = await db
      .select({ sessionId: anonSessions.id, startedAt: anonSessions.startedAt })
      .from(sessionParticipants)
      .innerJoin(anonSessions, eq(anonSessions.id, sessionParticipants.sessionId))
      .where(and(eq(sessionParticipants.userId, userId), eq(anonSessions.status, 'active')))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Participant user ids for a session (to notify the other party). */
  async getParticipants(sessionId: string): Promise<string[]> {
    const rows = await db
      .select({ userId: sessionParticipants.userId })
      .from(sessionParticipants)
      .where(eq(sessionParticipants.sessionId, sessionId));
    return rows.map((r) => r.userId);
  },

  async isParticipant(sessionId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: sessionParticipants.userId })
      .from(sessionParticipants)
      .where(
        and(eq(sessionParticipants.sessionId, sessionId), eq(sessionParticipants.userId, userId)),
      )
      .limit(1);
    return rows.length > 0;
  },

  /** Ends an active session and writes a history row. Idempotent-ish. */
  async endSession(
    sessionId: string,
    reason: 'left' | 'disconnect' | 'expired' | 'reported',
  ): Promise<{ participants: string[] } | null> {
    return db.transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(anonSessions)
        .where(eq(anonSessions.id, sessionId))
        .limit(1);
      if (!session || session.status !== 'active') return null;

      const endedAt = new Date();
      const status = reason === 'expired' ? 'expired' : 'ended';
      await tx
        .update(anonSessions)
        .set({ status, endedAt, endReason: reason })
        .where(eq(anonSessions.id, sessionId));
      await tx
        .update(sessionParticipants)
        .set({ leftAt: endedAt })
        .where(eq(sessionParticipants.sessionId, sessionId));

      const parts = await tx
        .select({ userId: sessionParticipants.userId })
        .from(sessionParticipants)
        .where(eq(sessionParticipants.sessionId, sessionId));
      const ids = parts.map((p) => p.userId);

      if (ids.length === 2) {
        const durationSeconds = Math.max(
          0,
          Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000),
        );
        const [a, b] = [...ids].sort();
        if (a && b) {
          await tx.insert(matchHistory).values({ sessionId, userA: a, userB: b, durationSeconds });
        }
      }
      return { participants: ids };
    });
  },

  // --- Recovery & cleanup (MATCHING_ENGINE.md §5.8–5.9, §9) ---

  /** On startup: clear stale waiting rows (their sockets are gone). */
  async clearAllWaiting(): Promise<void> {
    await db.delete(matchQueue).where(eq(matchQueue.status, 'waiting'));
  },

  /** On startup: expire orphaned active sessions left by an ungraceful stop. */
  async expireAllActiveSessions(): Promise<void> {
    await db
      .update(anonSessions)
      .set({ status: 'expired', endedAt: new Date(), endReason: 'expired' })
      .where(eq(anonSessions.status, 'active'));
  },

  /** Queue rows with no heartbeat since `before` (stale cleanup sweep). */
  async findStaleWaiting(before: Date): Promise<string[]> {
    const rows = await db
      .select({ userId: matchQueue.userId })
      .from(matchQueue)
      .where(and(eq(matchQueue.status, 'waiting'), lt(matchQueue.lastHeartbeatAt, before)));
    return rows.map((r) => r.userId);
  },

  /** Recent-pairing check to avoid immediately rematching the same person. */
  async wereRecentlyMatched(userId: string, otherId: string, since: Date): Promise<boolean> {
    const [a, b] = [userId, otherId].sort();
    if (!a || !b) return false;
    const rows = await db
      .select({ id: matchHistory.id })
      .from(matchHistory)
      .where(
        and(
          eq(matchHistory.userA, a),
          eq(matchHistory.userB, b),
          sql`${matchHistory.createdAt} > ${since}`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  /**
   * Marks the most recent match between two users as converted to a friendship
   * (MATCHING_ENGINE.md §12 — the friend-conversion metric). Best-effort.
   */
  async markBecameFriends(a: string, b: string): Promise<void> {
    const [low, high] = [a, b].sort();
    if (!low || !high) return;
    const rows = await db
      .select({ id: matchHistory.id })
      .from(matchHistory)
      .where(and(eq(matchHistory.userA, low), eq(matchHistory.userB, high)))
      .orderBy(sql`${matchHistory.createdAt} desc`)
      .limit(1);
    const latest = rows[0];
    if (latest) {
      await db
        .update(matchHistory)
        .set({ becameFriends: true })
        .where(eq(matchHistory.id, latest.id));
    }
  },

  /** A user's recent match history (GET /matching/history). */
  async historyForUser(userId: string, limit = 20) {
    return db
      .select({
        sessionId: matchHistory.sessionId,
        durationSeconds: matchHistory.durationSeconds,
        becameFriends: matchHistory.becameFriends,
        createdAt: matchHistory.createdAt,
      })
      .from(matchHistory)
      .where(or(eq(matchHistory.userA, userId), eq(matchHistory.userB, userId)))
      .orderBy(sql`${matchHistory.createdAt} desc`)
      .limit(limit);
  },
};
