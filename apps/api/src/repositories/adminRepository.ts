import { and, desc, eq, gte, ilike, lt, or, sql } from 'drizzle-orm';
import type { AnnouncementAudience } from '@campusly/shared-types';
import { db } from '../db/client.js';
import {
  users,
  communities,
  wallPosts,
  featureFlags,
  announcements,
  type UserRow,
  type FeatureFlagRow,
  type AnnouncementRow,
} from '../db/schema.js';

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
};
