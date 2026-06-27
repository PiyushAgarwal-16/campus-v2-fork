import type { ChatMessage, MessageContextType } from '@campusly/shared-types';
import { apiFetch } from './apiClient';

/** Messaging REST (history). Live delivery is over the socket. */
export const messagingApi = {
  async history(
    contextType: MessageContextType,
    contextId: string,
    cursor?: string,
  ): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> {
    const params = new URLSearchParams({ contextType, contextId });
    if (cursor) params.set('cursor', cursor);
    return apiFetch<{ messages: ChatMessage[]; nextCursor: string | null }>(
      `/messages?${params.toString()}`,
    );
  },
};
