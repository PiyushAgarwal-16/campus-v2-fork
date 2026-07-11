import type { AppNotification } from '@campusly/shared-types';
import { apiFetch } from './apiClient';

/**
 * In-app notification REST (NOTIFICATION_SYSTEM.md, API_SPEC.md). Backs the
 * notifications screen and the unread badge; live arrivals come over the socket
 * (`notification_new`, see useNotifications).
 */
export const notificationsApi = {
  async list(
    cursor?: string,
    limit = 20,
  ): Promise<{ notifications: AppNotification[]; nextCursor: string | null }> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set('cursor', cursor);
    return apiFetch(`/notifications?${params.toString()}`);
  },

  async unreadCount(): Promise<number> {
    const data = await apiFetch<{ count: number }>('/notifications/unread-count');
    return data.count;
  },

  async markRead(id: string): Promise<void> {
    await apiFetch(`/notifications/${id}/read`, { method: 'POST' });
  },

  async markAllRead(): Promise<void> {
    await apiFetch('/notifications/read-all', { method: 'POST' });
  },
};
