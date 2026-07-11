'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  NOTIFICATION_SERVER_EVENTS,
  type AppNotification,
  type NewNotificationPayload,
} from '@campusly/shared-types';
import { connectSocket, getSocket } from '../lib/socket';
import { notificationsApi } from '../lib/notifications';

/**
 * Drives the notification surfaces (NOTIFICATION_SYSTEM.md): the unread badge in
 * the nav and the notifications screen. Loads the unread count over REST, then
 * keeps it live via the `notification_new` socket event (SOCKET_EVENTS.md §10).
 */
export function useNotifications() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refreshCount = useCallback(() => {
    void notificationsApi
      .unreadCount()
      .then(setUnreadCount)
      .catch(() => {});
  }, []);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    try {
      const { notifications, nextCursor: cursor } = await notificationsApi.list();
      setItems(notifications);
      setNextCursor(cursor);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const { notifications, nextCursor: cursor } = await notificationsApi.list(nextCursor);
    setItems((prev) => [...prev, ...notifications]);
    setNextCursor(cursor);
  }, [nextCursor]);

  const markAllRead = useCallback(async () => {
    await notificationsApi.markAllRead();
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
  }, []);

  // Initial unread count + live updates.
  useEffect(() => {
    refreshCount();
    const socket = connectSocket();

    const onNew = (payload: NewNotificationPayload) => {
      setUnreadCount(payload.unreadCount);
      setItems((prev) => [payload.notification, ...prev]);
    };

    socket.on(NOTIFICATION_SERVER_EVENTS.NEW, onNew);
    return () => {
      socket.off(NOTIFICATION_SERVER_EVENTS.NEW, onNew);
    };
  }, [refreshCount]);

  useEffect(() => {
    getSocket();
  }, []);

  return {
    unreadCount,
    items,
    nextCursor,
    loading,
    loadFirst,
    loadMore,
    markAllRead,
    refreshCount,
  };
}
