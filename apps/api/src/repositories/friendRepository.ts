import { and, eq, or, isNull, desc, sql } from 'drizzle-orm';
import type { FriendRequestOrigin } from '@campusly/shared-types';
import { db } from '../db/client.js';
import {
  friendRequests,
  friendships,
  blockedUsers,
  type FriendRequestRow,
  type FriendshipRow,
} from '../db/schema.js';

/**
 * Data access for the Friend module (DATABASE_SCHEMA.md §9). Friendships are
 * order-normalized (`user_low < user_high`) so each pair has exactly one row.
 * Blocks are directional; enforcement queries check both directions.
 */

/** Lexicographic ordering for the symmetric friendship key. */
function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export const friendRepository = {
  // --- Requests ---

  async createRequest(
    senderId: string,
    receiverId: string,
    origin: FriendRequestOrigin,
  ): Promise<FriendRequestRow> {
    const [row] = await db
      .insert(friendRequests)
      .values({ senderId, receiverId, origin, status: 'pending' })
      .returning();
    if (!row) throw new Error('Failed to create friend request');
    return row;
  },

  /** Any pending request between the pair, in either direction. */
  async findPendingBetween(a: string, b: string): Promise<FriendRequestRow | null> {
    const rows = await db
      .select()
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.status, 'pending'),
          or(
            and(eq(friendRequests.senderId, a), eq(friendRequests.receiverId, b)),
            and(eq(friendRequests.senderId, b), eq(friendRequests.receiverId, a)),
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  async findRequestById(id: string): Promise<FriendRequestRow | null> {
    const rows = await db.select().from(friendRequests).where(eq(friendRequests.id, id)).limit(1);
    return rows[0] ?? null;
  },

  async setRequestStatus(id: string, status: 'accepted' | 'rejected' | 'cancelled'): Promise<void> {
    await db
      .update(friendRequests)
      .set({ status, respondedAt: new Date() })
      .where(eq(friendRequests.id, id));
  },

  async listIncoming(userId: string): Promise<FriendRequestRow[]> {
    return db
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.receiverId, userId), eq(friendRequests.status, 'pending')))
      .orderBy(desc(friendRequests.createdAt));
  },

  async listOutgoing(userId: string): Promise<FriendRequestRow[]> {
    return db
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.senderId, userId), eq(friendRequests.status, 'pending')))
      .orderBy(desc(friendRequests.createdAt));
  },

  async countPendingOutgoing(userId: string): Promise<number> {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(friendRequests)
      .where(and(eq(friendRequests.senderId, userId), eq(friendRequests.status, 'pending')));
    return rows[0]?.count ?? 0;
  },

  /** Most recent rejection time of sender→receiver (drives the re-request cooldown). */
  async lastRejectionAt(senderId: string, receiverId: string): Promise<Date | null> {
    const rows = await db
      .select({ respondedAt: friendRequests.respondedAt })
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.senderId, senderId),
          eq(friendRequests.receiverId, receiverId),
          eq(friendRequests.status, 'rejected'),
        ),
      )
      .orderBy(desc(friendRequests.respondedAt))
      .limit(1);
    return rows[0]?.respondedAt ?? null;
  },

  /**
   * Accepts a request transactionally: marks it accepted and creates (or
   * reuses) the order-normalized friendship. Returns the friendship row.
   */
  async acceptRequest(requestId: string, a: string, b: string): Promise<FriendshipRow> {
    const [low, high] = orderPair(a, b);
    return db.transaction(async (tx) => {
      await tx
        .update(friendRequests)
        .set({ status: 'accepted', respondedAt: new Date() })
        .where(eq(friendRequests.id, requestId));
      // Also resolve any reverse pending request (mutual-intent cleanup).
      await tx
        .update(friendRequests)
        .set({ status: 'accepted', respondedAt: new Date() })
        .where(
          and(
            eq(friendRequests.status, 'pending'),
            eq(friendRequests.senderId, b),
            eq(friendRequests.receiverId, a),
          ),
        );
      const existing = await tx
        .select()
        .from(friendships)
        .where(and(eq(friendships.userLow, low), eq(friendships.userHigh, high)))
        .limit(1);
      if (existing[0]) {
        // Revive a previously removed friendship if present.
        if (existing[0].deletedAt) {
          await tx
            .update(friendships)
            .set({ deletedAt: null, createdAt: new Date() })
            .where(eq(friendships.id, existing[0].id));
          return { ...existing[0], deletedAt: null };
        }
        return existing[0];
      }
      const [created] = await tx
        .insert(friendships)
        .values({ userLow: low, userHigh: high })
        .returning();
      if (!created) throw new Error('Failed to create friendship');
      return created;
    });
  },

  // --- Friendships ---

  async getFriendshipById(id: string): Promise<FriendshipRow | null> {
    const rows = await db.select().from(friendships).where(eq(friendships.id, id)).limit(1);
    return rows[0] ?? null;
  },

  /** The active friendship row for a pair, if any. */
  async findActiveFriendship(a: string, b: string): Promise<FriendshipRow | null> {
    const [low, high] = orderPair(a, b);
    const rows = await db
      .select()
      .from(friendships)
      .where(
        and(
          eq(friendships.userLow, low),
          eq(friendships.userHigh, high),
          isNull(friendships.deletedAt),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  },

  async areFriends(a: string, b: string): Promise<boolean> {
    return (await this.findActiveFriendship(a, b)) !== null;
  },

  /** A user's active friendships: returns friendshipId, the other user, and since. */
  async listFriends(
    userId: string,
  ): Promise<{ friendshipId: string; otherUserId: string; since: Date }[]> {
    const rows = await db
      .select()
      .from(friendships)
      .where(
        and(
          or(eq(friendships.userLow, userId), eq(friendships.userHigh, userId)),
          isNull(friendships.deletedAt),
        ),
      )
      .orderBy(desc(friendships.createdAt));
    return rows.map((r) => ({
      friendshipId: r.id,
      otherUserId: r.userLow === userId ? r.userHigh : r.userLow,
      since: r.createdAt,
    }));
  },

  async softDeleteFriendship(id: string): Promise<void> {
    await db.update(friendships).set({ deletedAt: new Date() }).where(eq(friendships.id, id));
  },

  // --- Blocks ---

  /** Blocks a user and severs any friendship in one transaction. */
  async block(blockerId: string, blockedId: string, reason?: string): Promise<void> {
    const [low, high] = orderPair(blockerId, blockedId);
    await db.transaction(async (tx) => {
      await tx
        .insert(blockedUsers)
        .values({ blockerId, blockedId, reason: reason ?? null })
        .onConflictDoNothing();
      await tx
        .update(friendships)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(friendships.userLow, low),
            eq(friendships.userHigh, high),
            isNull(friendships.deletedAt),
          ),
        );
      // Cancel any pending requests between the two, either direction.
      await tx
        .update(friendRequests)
        .set({ status: 'cancelled', respondedAt: new Date() })
        .where(
          and(
            eq(friendRequests.status, 'pending'),
            or(
              and(eq(friendRequests.senderId, blockerId), eq(friendRequests.receiverId, blockedId)),
              and(eq(friendRequests.senderId, blockedId), eq(friendRequests.receiverId, blockerId)),
            ),
          ),
        );
    });
  },

  async unblock(blockerId: string, blockedId: string): Promise<void> {
    await db
      .delete(blockedUsers)
      .where(and(eq(blockedUsers.blockerId, blockerId), eq(blockedUsers.blockedId, blockedId)));
  },

  /** True if either user has blocked the other (bidirectional enforcement). */
  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const rows = await db
      .select({ blockerId: blockedUsers.blockerId })
      .from(blockedUsers)
      .where(
        or(
          and(eq(blockedUsers.blockerId, a), eq(blockedUsers.blockedId, b)),
          and(eq(blockedUsers.blockerId, b), eq(blockedUsers.blockedId, a)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  async listBlocked(blockerId: string): Promise<{ blockedId: string; createdAt: Date }[]> {
    const rows = await db
      .select({ blockedId: blockedUsers.blockedId, createdAt: blockedUsers.createdAt })
      .from(blockedUsers)
      .where(eq(blockedUsers.blockerId, blockerId))
      .orderBy(desc(blockedUsers.createdAt));
    return rows;
  },
};
