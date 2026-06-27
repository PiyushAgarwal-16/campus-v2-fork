import type { ChatMessage, MessageContextType } from '@campusly/shared-types';
import { ForbiddenError } from '../domain/errors.js';
import type { MessageRow } from '../db/schema.js';
import { messagingRepository } from '../repositories/messagingRepository.js';
import { matchingRepository } from '../repositories/matchingRepository.js';

/**
 * Messaging business logic (ARCHITECTURE.md §6). Transport-agnostic: the same
 * service serves Socket.IO and REST. Phase 04 wires the anon_session context;
 * the friendship context activates in Phase 05.
 */

function toChatMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    contextType: row.contextType,
    contextId: (row.sessionId ?? row.friendshipId) as string,
    senderId: row.senderId,
    type: row.type,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

export const messagingService = {
  /** True if the user may read/write this conversation. */
  async authorize(
    userId: string,
    contextType: MessageContextType,
    contextId: string,
  ): Promise<boolean> {
    if (contextType === 'anon_session') {
      return matchingRepository.isParticipant(contextId, userId);
    }
    // friendship context — implemented in Phase 05 (friend chat).
    return false;
  },

  /** The user ids that should receive events for this conversation. */
  async recipients(contextType: MessageContextType, contextId: string): Promise<string[]> {
    if (contextType === 'anon_session') {
      return matchingRepository.getParticipants(contextId);
    }
    return [];
  },

  async assertAuthorized(
    userId: string,
    contextType: MessageContextType,
    contextId: string,
  ): Promise<void> {
    if (!(await this.authorize(userId, contextType, contextId))) {
      throw new ForbiddenError('You are not a participant in this conversation.');
    }
  },

  /** Persist a message; returns the stored message and who should receive it. */
  async sendMessage(
    senderId: string,
    input: { contextType: MessageContextType; contextId: string; body: string },
  ): Promise<{ message: ChatMessage; recipients: string[] }> {
    await this.assertAuthorized(senderId, input.contextType, input.contextId);
    const row = await messagingRepository.insert({
      contextType: input.contextType,
      contextId: input.contextId,
      senderId,
      body: input.body,
    });
    const recipients = await this.recipients(input.contextType, input.contextId);
    return { message: toChatMessage(row), recipients };
  },

  async markRead(
    userId: string,
    contextType: MessageContextType,
    contextId: string,
    lastReadMessageId: string,
  ): Promise<string[]> {
    await this.assertAuthorized(userId, contextType, contextId);
    await messagingRepository.upsertReceipt({ userId, contextType, contextId, lastReadMessageId });
    return this.recipients(contextType, contextId);
  },

  /** Paginated history (newest-first from DB, returned chronological for display). */
  async history(
    userId: string,
    query: { contextType: MessageContextType; contextId: string; cursor?: string; limit: number },
  ): Promise<{ messages: ChatMessage[]; nextCursor: string | null }> {
    await this.assertAuthorized(userId, query.contextType, query.contextId);
    const rows = await messagingRepository.history(query);
    const nextCursor =
      rows.length === query.limit ? (rows[rows.length - 1]?.createdAt.toISOString() ?? null) : null;
    return { messages: rows.reverse().map(toChatMessage), nextCursor };
  },
};
