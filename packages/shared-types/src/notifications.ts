/**
 * In-app notification contracts (DATABASE_SCHEMA.md §16, NOTIFICATION_SYSTEM.md).
 * Domain events (likes, friend requests, replies, announcements) produce a
 * persisted notification that is also pushed live over the socket.
 */

export const NOTIFICATION_TYPES = [
  'friend_request',
  'friend_accepted',
  'match',
  'message',
  'wall_reply',
  'wall_reaction',
  'community',
  'announcement',
  'moderation',
  'system',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** A user-facing in-app notification. */
export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  /** Deep-link context (e.g. { postId, userId }). */
  data: Record<string, string> | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationListResponse {
  notifications: AppNotification[];
  nextCursor: string | null;
}

export interface UnreadCountResponse {
  count: number;
}

/** Server → client socket events (SOCKET_EVENTS.md §10). */
export const NOTIFICATION_SERVER_EVENTS = {
  /** A new notification arrived; payload carries the notification + unread count. */
  NEW: 'notification_new',
} as const;

export interface NewNotificationPayload {
  notification: AppNotification;
  unreadCount: number;
}
