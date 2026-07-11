import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { NotificationType } from '@campusly/shared-types';
import { db } from '../db/client.js';
import { notifications, type NotificationRow } from '../db/schema.js';

/**
 * Data access for in-app notifications (DATABASE_SCHEMA.md §16.1).
 */
export const notificationRepository = {
  async create(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body?: string | null;
    data?: Record<string, string> | null;
  }): Promise<NotificationRow> {
    const [row] = await db
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        data: input.data ?? null,
      })
      .returning();
    if (!row) throw new Error('Failed to create notification');
    return row;
  },

  async list(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<NotificationRow[]> {
    const conditions = [eq(notifications.userId, userId)];
    if (cursor) conditions.push(lt(notifications.createdAt, new Date(cursor)));
    return db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  },

  async unreadCount(userId: string): Promise<number> {
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return rows[0]?.c ?? 0;
  },

  async markRead(userId: string, id: string): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)));
  },

  async markAllRead(userId: string): Promise<void> {
    await db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  },
};
