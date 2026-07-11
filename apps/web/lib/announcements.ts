import type { Announcement } from '@campusly/shared-types';
import { apiFetch } from './apiClient';

/**
 * Student-facing announcements (ADMIN_PANEL.md §9). Fetches the announcements
 * currently active for the caller's campus; live arrivals come over the
 * `announcement_broadcast` socket event (see useAnnouncements).
 */
export const announcementsApi = {
  async active(): Promise<Announcement[]> {
    const data = await apiFetch<{ announcements: Announcement[] }>('/announcements');
    return data.announcements;
  },
};
