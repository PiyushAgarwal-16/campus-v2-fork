import { z } from 'zod';

/**
 * Messaging contracts (DATABASE_SCHEMA.md §8, SOCKET_EVENTS.md §5).
 * Unified across anonymous sessions and (Phase 05) friend chats.
 */

export const MESSAGE_CONTEXTS = ['anon_session', 'friendship'] as const;
export type MessageContextType = (typeof MESSAGE_CONTEXTS)[number];

export const MESSAGE_TYPES = ['text', 'voice', 'image', 'system'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

/** A chat message as delivered to clients. */
export interface ChatMessage {
  id: string;
  contextType: MessageContextType;
  contextId: string; // sessionId or friendshipId
  senderId: string;
  type: MessageType;
  body: string | null;
  createdAt: string;
}

/** Client → server socket events. */
export const CHAT_CLIENT_EVENTS = {
  SEND_MESSAGE: 'send_message',
  MESSAGE_READ: 'message_read',
  TYPING_START: 'typing_start',
  TYPING_STOP: 'typing_stop',
} as const;

/** Server → client socket events. */
export const CHAT_SERVER_EVENTS = {
  RECEIVE_MESSAGE: 'receive_message',
  MESSAGE_READ: 'message_read',
  TYPING_START: 'typing_start',
  TYPING_STOP: 'typing_stop',
} as const;

/** Payload for sending a message over the socket. */
export const SendMessageSchema = z.object({
  contextType: z.enum(MESSAGE_CONTEXTS),
  contextId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
});
export type SendMessagePayload = z.infer<typeof SendMessageSchema>;

export interface TypingPayload {
  contextType: MessageContextType;
  contextId: string;
  userId: string;
}

export interface MessageReadPayload {
  contextType: MessageContextType;
  contextId: string;
  userId: string;
  lastReadMessageId: string;
}

/** Query for paginated history (REST). */
export const MessageHistoryQuerySchema = z.object({
  contextType: z.enum(MESSAGE_CONTEXTS),
  contextId: z.string().uuid(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type MessageHistoryQuery = z.infer<typeof MessageHistoryQuerySchema>;
