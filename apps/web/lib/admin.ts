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
  UserSubscriptionState,
  SubscriptionPlan,
  ReportContext,
  InspectedPost,
  InspectedMediaMeta,
  ConversationTranscript,
  BulkActionResult,
  UniversityOption,
  CreateUserInput,
  EditUserInput,
  ChangeRoleInput,
  DeleteUserInput,
  GrantSubscriptionInput,
  ChangeSubscriptionInput,
  RevokeSubscriptionInput,
  BulkActionInput,
  InspectConversationInput,
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

  // --- User lifecycle (Requirements 4, 5) ---

  createUser: (input: CreateUserInput) =>
    apiFetch<{ user: AdminUser }>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  editUser: (id: string, input: EditUserInput) =>
    apiFetch<{ user: AdminUser }>(`/admin/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  changeUserRole: (id: string, input: ChangeRoleInput) =>
    apiFetch<{ user: AdminUser }>(`/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  deleteUser: (id: string, input: DeleteUserInput) =>
    apiFetch(`/admin/users/${id}`, { method: 'DELETE', body: JSON.stringify(input) }),

  // --- Subscriptions (Requirement 6) ---

  getSubscription: (userId: string) =>
    apiFetch<{ subscription: UserSubscriptionState }>(`/admin/users/${userId}/subscription`),

  grantSubscription: (userId: string, input: GrantSubscriptionInput) =>
    apiFetch<{ subscription: UserSubscriptionState }>(`/admin/users/${userId}/subscription/grant`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  revokeSubscription: (userId: string, input: RevokeSubscriptionInput) =>
    apiFetch(`/admin/users/${userId}/subscription/revoke`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  changeSubscription: (userId: string, input: ChangeSubscriptionInput) =>
    apiFetch<{ subscription: UserSubscriptionState }>(`/admin/users/${userId}/subscription`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  subscriptionPlans: () => apiFetch<{ plans: SubscriptionPlan[] }>('/admin/subscription-plans'),

  universities: () =>
    apiFetch<{ universities: UniversityOption[] }>('/admin/universities').then(
      (d) => d.universities,
    ),

  // --- Report context (Requirement 7) ---

  reportContext: (id: string, reveal?: boolean) => {
    const q = reveal ? '?reveal=true' : '';
    return apiFetch<ReportContext>(`/admin/reports/${id}/context${q}`);
  },

  // --- Bulk actions (Requirement 11) ---

  bulkAction: (input: BulkActionInput) =>
    apiFetch<{ results: BulkActionResult[] }>('/admin/bulk-actions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // --- Data inspector (Requirement 8) ---

  inspectorPosts: (cursor?: string) => {
    const q = new URLSearchParams();
    if (cursor) q.set('cursor', cursor);
    return apiFetch<{ items: InspectedPost[]; nextCursor: string | null }>(
      `/admin/inspector/posts?${q.toString()}`,
    );
  },

  inspectorCommunityPosts: (cursor?: string) => {
    const q = new URLSearchParams();
    if (cursor) q.set('cursor', cursor);
    return apiFetch<{ items: InspectedPost[]; nextCursor: string | null }>(
      `/admin/inspector/community-posts?${q.toString()}`,
    );
  },

  inspectorMedia: (cursor?: string) => {
    const q = new URLSearchParams();
    if (cursor) q.set('cursor', cursor);
    return apiFetch<{ items: InspectedMediaMeta[]; nextCursor: string | null }>(
      `/admin/inspector/media?${q.toString()}`,
    );
  },

  inspectConversation: (input: InspectConversationInput) =>
    apiFetch<ConversationTranscript>('/admin/inspector/conversation', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  mediaUrl: (id: string) =>
    apiFetch<{ url: string; expiresAt: string }>(`/admin/inspector/media/${id}/url`),
};
