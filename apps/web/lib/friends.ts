import type {
  FriendSummary,
  IncomingFriendRequest,
  OutgoingFriendRequest,
  BlockedUserItem,
  SendFriendRequestInput,
} from '@campusly/shared-types';
import { apiFetch } from './apiClient';

/**
 * Friend system REST (API_SPEC.md §6). State changes go through these calls;
 * real-time updates arrive over the socket (see useFriends).
 */
export const friendsApi = {
  async sendRequest(
    input: SendFriendRequestInput,
  ): Promise<{ requestId?: string; friendshipId?: string; status: 'pending' | 'accepted' }> {
    return apiFetch('/friends/requests', { method: 'POST', body: JSON.stringify(input) });
  },

  async listFriends(): Promise<FriendSummary[]> {
    const data = await apiFetch<{ friends: FriendSummary[] }>('/friends');
    return data.friends;
  },

  async listIncoming(): Promise<IncomingFriendRequest[]> {
    const data = await apiFetch<{ requests: IncomingFriendRequest[] }>(
      '/friends/requests/incoming',
    );
    return data.requests;
  },

  async listOutgoing(): Promise<OutgoingFriendRequest[]> {
    const data = await apiFetch<{ requests: OutgoingFriendRequest[] }>(
      '/friends/requests/outgoing',
    );
    return data.requests;
  },

  async accept(requestId: string): Promise<{ friendshipId: string }> {
    return apiFetch(`/friends/requests/${requestId}/accept`, { method: 'POST' });
  },

  async reject(requestId: string): Promise<void> {
    await apiFetch(`/friends/requests/${requestId}/reject`, { method: 'POST' });
  },

  async cancel(requestId: string): Promise<void> {
    await apiFetch(`/friends/requests/${requestId}`, { method: 'DELETE' });
  },

  async removeFriend(friendshipId: string): Promise<void> {
    await apiFetch(`/friends/${friendshipId}`, { method: 'DELETE' });
  },

  async block(userId: string, reason?: string): Promise<void> {
    await apiFetch('/friends/block', { method: 'POST', body: JSON.stringify({ userId, reason }) });
  },

  async unblock(userId: string): Promise<void> {
    await apiFetch(`/friends/block/${userId}`, { method: 'DELETE' });
  },

  async listBlocked(): Promise<BlockedUserItem[]> {
    const data = await apiFetch<{ blocked: BlockedUserItem[] }>('/friends/blocked');
    return data.blocked;
  },
};
