'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CHAT_CLIENT_EVENTS,
  CHAT_SERVER_EVENTS,
  type ChatMessage,
  type MessageContextType,
  type TypingPayload,
} from '@campusly/shared-types';
import { getSocket } from '../lib/socket';
import { messagingApi } from '../lib/messaging';

/**
 * Drives a single conversation (ARCHITECTURE.md §6): loads durable history over
 * REST, then layers live socket events (receive_message, typing). Reused by
 * anonymous sessions now and friend chats in Phase 05.
 */
export function useConversation(contextType: MessageContextType, contextId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load history when the conversation opens.
  useEffect(() => {
    if (!contextId) return;
    let cancelled = false;
    setMessages([]);
    void messagingApi.history(contextType, contextId).then((res) => {
      if (!cancelled) setMessages(res.messages);
    });
    return () => {
      cancelled = true;
    };
  }, [contextType, contextId]);

  // Live events.
  useEffect(() => {
    if (!contextId) return;
    const socket = getSocket();

    const onMessage = (msg: ChatMessage) => {
      if (msg.contextId !== contextId) return;
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
    };
    const onTypingStart = (p: TypingPayload) => {
      if (p.contextId === contextId) setPartnerTyping(true);
    };
    const onTypingStop = (p: TypingPayload) => {
      if (p.contextId === contextId) setPartnerTyping(false);
    };

    socket.on(CHAT_SERVER_EVENTS.RECEIVE_MESSAGE, onMessage);
    socket.on(CHAT_SERVER_EVENTS.TYPING_START, onTypingStart);
    socket.on(CHAT_SERVER_EVENTS.TYPING_STOP, onTypingStop);

    return () => {
      socket.off(CHAT_SERVER_EVENTS.RECEIVE_MESSAGE, onMessage);
      socket.off(CHAT_SERVER_EVENTS.TYPING_START, onTypingStart);
      socket.off(CHAT_SERVER_EVENTS.TYPING_STOP, onTypingStop);
    };
  }, [contextType, contextId]);

  const send = useCallback(
    (body: string) => {
      const trimmed = body.trim();
      if (!trimmed || !contextId) return;
      getSocket().emit(CHAT_CLIENT_EVENTS.SEND_MESSAGE, { contextType, contextId, body: trimmed });
      getSocket().emit(CHAT_CLIENT_EVENTS.TYPING_STOP, { contextType, contextId });
    },
    [contextType, contextId],
  );

  const notifyTyping = useCallback(() => {
    if (!contextId) return;
    const socket = getSocket();
    socket.emit(CHAT_CLIENT_EVENTS.TYPING_START, { contextType, contextId });
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(
      () => socket.emit(CHAT_CLIENT_EVENTS.TYPING_STOP, { contextType, contextId }),
      2000,
    );
  }, [contextType, contextId]);

  return { messages, partnerTyping, send, notifyTyping };
}
