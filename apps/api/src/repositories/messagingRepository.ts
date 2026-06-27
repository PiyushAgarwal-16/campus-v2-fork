import { and, desc, eq, lt, isNull, sql } from 'drizzle-orm';
import type { MessageContextType } from '@campusly/shared-types';
import { db } from '../db/client.js';
import { messages, messageReceipts, type MessageRow } from '../db/schema.js';

/**
 * Data access for messaging (DATABASE_SCHEMA.md §8). A message belongs to one
 * context; the contextId maps to session_id or friendship_id by context_type.
 */
function contextColumns(contextType: MessageContextType, contextId: string) {
  return contextType === 'anon_session'
    ? { sessionId: contextId, friendshipId: null }
    : { sessionId: null, friendshipId: contextId };
}

export const messagingRepository = {
  async insert(input: {
    contextType: MessageContextType;
    contextId: string;
    senderId: string;
    body: string;
  }): Promise<MessageRow> {
    const [row] = await db
      .insert(messages)
      .values({
        contextType: input.contextType,
        ...contextColumns(input.contextType, input.contextId),
        senderId: input.senderId,
        type: 'text',
        body: input.body,
      })
      .returning();
    if (!row) throw new Error('Failed to persist message');
    return row;
  },

  /**
   * Cursor-paginated history, newest-first (API_SPEC.md §2.4). Cursor is the
   * created_at ISO timestamp of the oldest row already loaded.
   */
  async history(input: {
    contextType: MessageContextType;
    contextId: string;
    cursor?: string;
    limit: number;
  }): Promise<MessageRow[]> {
    const col = input.contextType === 'anon_session' ? messages.sessionId : messages.friendshipId;
    const conditions = [
      eq(messages.contextType, input.contextType),
      eq(col, input.contextId),
      isNull(messages.deletedAt),
    ];
    if (input.cursor) conditions.push(lt(messages.createdAt, new Date(input.cursor)));
    return db
      .select()
      .from(messages)
      .where(and(...conditions))
      .orderBy(desc(messages.createdAt))
      .limit(input.limit);
  },

  /** Upserts a read high-water mark for a user in a conversation (§8.4, M-2). */
  async upsertReceipt(input: {
    userId: string;
    contextType: MessageContextType;
    contextId: string;
    lastReadMessageId: string;
  }): Promise<void> {
    const cols = contextColumns(input.contextType, input.contextId);
    await db
      .insert(messageReceipts)
      .values({
        userId: input.userId,
        contextType: input.contextType,
        ...cols,
        lastReadMessageId: input.lastReadMessageId,
        lastReadAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          messageReceipts.userId,
          messageReceipts.contextType,
          messageReceipts.sessionId,
          messageReceipts.friendshipId,
        ],
        set: {
          lastReadMessageId: input.lastReadMessageId,
          lastReadAt: new Date(),
          updatedAt: sql`now()`,
        },
      });
  },
};
