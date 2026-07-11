import type { AppNotification, NotificationType } from '@campusly/shared-types';
import { NOTIFICATION_SERVER_EVENTS } from '@campusly/shared-types';
import type { NotificationRow } from '../db/schema.js';
import { notificationRepository } from '../repositories/notificationRepository.js';
import { notifier } from '../realtime/notifier.js';
import { logger } from '../config/logger.js';

/**
 * In-app notification service (NOTIFICATION_SYSTEM.md, DATABASE_SCHEMA.md §16).
 * Persists a notification then pushes it live to the recipient's user room with
 * an updated unread count. Domain services call the typed helpers below; a
 * failure here never breaks the originating action (fire-and-forget, logged).
 */

function toDto(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    data: (row.data as Record<string, string> | null) ?? null,
    isRead: row.isRead,
    createdAt: row.createdAt.toISOString(),
  };
}

export const notificationService = {
  /** Core: persist + push. Never notify a user about their own action. */
  async notify(input: {
    userId: string;
    actorId?: string;
    type: NotificationType;
    title: string;
    body?: string;
    data?: Record<string, string>;
  }): Promise<void> {
    if (input.actorId && input.actorId === input.userId) return;
    try {
      const row = await notificationRepository.create({
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        data: input.data,
      });
      const unreadCount = await notificationRepository.unreadCount(input.userId);
      notifier.emitToUser(input.userId, NOTIFICATION_SERVER_EVENTS.NEW, {
        notification: toDto(row),
        unreadCount,
      });
    } catch (err) {
      logger.error({ err, userId: input.userId, type: input.type }, 'notification create failed');
    }
  },

  // --- Typed event helpers (kept fire-and-forget by callers via void) ---

  async friendRequest(receiverId: string, senderName: string | null): Promise<void> {
    await this.notify({
      userId: receiverId,
      type: 'friend_request',
      title: 'New friend request',
      body: senderName
        ? `${senderName} wants to be your friend.`
        : 'Someone wants to be your friend.',
    });
  },

  async friendAccepted(userId: string, byName: string, friendshipId: string): Promise<void> {
    await this.notify({
      userId,
      type: 'friend_accepted',
      title: 'Friend request accepted',
      body: `${byName} accepted your friend request.`,
      data: { friendshipId },
    });
  },

  async wallReply(
    postAuthorId: string,
    actorId: string,
    replierName: string,
    postId: string,
  ): Promise<void> {
    await this.notify({
      userId: postAuthorId,
      actorId,
      type: 'wall_reply',
      title: 'New reply',
      body: `${replierName} replied to your post.`,
      data: { postId },
    });
  },

  async wallReaction(
    postAuthorId: string,
    actorId: string,
    actorName: string,
    postId: string,
  ): Promise<void> {
    await this.notify({
      userId: postAuthorId,
      actorId,
      type: 'wall_reaction',
      title: 'New like',
      body: `${actorName} liked your post.`,
      data: { postId },
    });
  },

  // --- Reads (REST) ---

  async list(
    userId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ notifications: AppNotification[]; nextCursor: string | null }> {
    const rows = await notificationRepository.list(userId, cursor, limit);
    const nextCursor =
      rows.length === limit ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null;
    return { notifications: rows.map(toDto), nextCursor };
  },

  unreadCount(userId: string): Promise<number> {
    return notificationRepository.unreadCount(userId);
  },

  markRead(userId: string, id: string): Promise<void> {
    return notificationRepository.markRead(userId, id);
  },

  markAllRead(userId: string): Promise<void> {
    return notificationRepository.markAllRead(userId);
  },
};
