import type {
  AdminReport,
  AdminUser,
  UserHistory,
  DashboardMetrics,
  FeatureFlag,
  Announcement,
  AuditLogItem,
  Appeal,
  ApplyActionInput,
  SetUserStatusInput,
  CreateAnnouncementInput,
} from '@campusly/shared-types';
import { apiFetch } from './apiClient';

/** Admin & moderation REST client (API_SPEC.md §15). All routes RBAC-gated. */
export const adminApi = {
  dashboard: () => apiFetch<DashboardMetrics>('/admin/dashboard'),

  reports: (status?: string, cursor?: string) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (cursor) q.set('cursor', cursor);
    return apiFetch<{ reports: AdminReport[]; nextCursor: string | null }>(
      `/admin/reports?${q.toString()}`,
    );
  },

  resolveReport: (id: string, status: 'reviewing' | 'resolved' | 'dismissed') =>
    apiFetch(`/admin/reports/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  applyAction: (input: ApplyActionInput) =>
    apiFetch('/admin/moderation/actions', { method: 'POST', body: JSON.stringify(input) }),

  appeals: () =>
    apiFetch<{ appeals: Appeal[] }>('/admin/moderation/appeals').then((d) => d.appeals),

  resolveAppeal: (id: string, status: 'upheld' | 'overturned') =>
    apiFetch(`/admin/moderation/appeals/${id}`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),

  users: (q?: string, cursor?: string) => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (cursor) params.set('cursor', cursor);
    return apiFetch<{ users: AdminUser[]; nextCursor: string | null }>(
      `/admin/users?${params.toString()}`,
    );
  },

  userHistory: (id: string) => apiFetch<UserHistory>(`/admin/users/${id}`),

  setUserStatus: (id: string, input: SetUserStatusInput) =>
    apiFetch(`/admin/users/${id}/status`, { method: 'PATCH', body: JSON.stringify(input) }),

  flags: () => apiFetch<{ flags: FeatureFlag[] }>('/admin/feature-flags').then((d) => d.flags),

  setFlag: (key: string, isEnabled: boolean) =>
    apiFetch<{ flag: FeatureFlag }>(`/admin/feature-flags/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ isEnabled }),
    }).then((d) => d.flag),

  createAnnouncement: (input: CreateAnnouncementInput) =>
    apiFetch<{ announcement: Announcement }>('/admin/announcements', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((d) => d.announcement),

  announcements: () =>
    apiFetch<{ announcements: Announcement[] }>('/admin/announcements').then(
      (d) => d.announcements,
    ),

  auditLogs: (cursor?: string) => {
    const q = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
    return apiFetch<{ logs: AuditLogItem[]; nextCursor: string | null }>(`/admin/audit-logs${q}`);
  },
};
