import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import {
  MATCH_CLIENT_EVENTS,
  CHAT_CLIENT_EVENTS,
  CHAT_SERVER_EVENTS,
  SendMessageSchema,
} from '@campusly/shared-types';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { tokenService } from '../services/tokenService.js';
import { matchingService } from '../services/matchingService.js';
import { messagingService } from '../services/messagingService.js';

/**
 * Socket.IO server lifecycle (ARCHITECTURE.md §2.3, SOCKET_EVENTS.md §1–2, §14).
 *
 * Phase 01: connections are authenticated at the handshake — the client sends
 * its JWT access token in `socket.handshake.auth.token`. Invalid/missing tokens
 * are rejected before any domain handler runs. Authenticated sockets join their
 * per-user room. Domain events (chat, presence, matching) arrive in later phases.
 */
export function createSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: config.CORS_ORIGINS, credentials: true },
    path: '/socket.io',
  });

  // Handshake authentication (SOCKET_EVENTS.md §14). Fail closed.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('authentication_failed'));
      return;
    }
    try {
      const claims = tokenService.verifyAccessToken(token);
      socket.data.userId = claims.sub;
      socket.data.role = claims.role;
      socket.data.universityId = claims.universityId;
      next();
    } catch {
      next(new Error('authentication_failed'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    const universityId = socket.data.universityId as string;
    // Join the per-user room for notifications, friend-status, and match events.
    void socket.join(`user:${userId}`);
    logger.info({ socketId: socket.id, userId }, 'Socket authenticated and connected');

    // --- Anonymous matching events (SOCKET_EVENTS.md §4) ---
    socket.on(MATCH_CLIENT_EVENTS.JOIN_QUEUE, () => {
      void matchingService.joinQueue(userId, universityId).catch((err) => {
        logger.error({ err, userId }, 'join_queue failed');
      });
    });

    socket.on(MATCH_CLIENT_EVENTS.LEAVE_QUEUE, () => {
      void matchingService.leaveQueue(userId).catch((err) => {
        logger.error({ err, userId }, 'leave_queue failed');
      });
    });

    socket.on(MATCH_CLIENT_EVENTS.LEAVE_SESSION, (payload: { sessionId?: string }) => {
      if (!payload?.sessionId) return;
      void matchingService.leaveSession(payload.sessionId, userId).catch((err) => {
        logger.error({ err, userId }, 'leave_session failed');
      });
    });

    socket.on(MATCH_CLIENT_EVENTS.HEARTBEAT, () => {
      matchingService.heartbeat(userId);
    });

    // --- Chat events (SOCKET_EVENTS.md §5) ---
    socket.on(CHAT_CLIENT_EVENTS.SEND_MESSAGE, (raw: unknown) => {
      const parsed = SendMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      void messagingService
        .sendMessage(userId, parsed.data)
        .then(({ message, recipients }) => {
          for (const uid of recipients) {
            io.to(`user:${uid}`).emit(CHAT_SERVER_EVENTS.RECEIVE_MESSAGE, message);
          }
        })
        .catch((err) => logger.error({ err, userId }, 'send_message failed'));
    });

    socket.on(
      CHAT_CLIENT_EVENTS.MESSAGE_READ,
      (raw: { contextType?: string; contextId?: string; lastReadMessageId?: string }) => {
        const { contextType, contextId, lastReadMessageId } = raw ?? {};
        if (
          (contextType !== 'anon_session' && contextType !== 'friendship') ||
          !contextId ||
          !lastReadMessageId
        ) {
          return;
        }
        void messagingService
          .markRead(userId, contextType, contextId, lastReadMessageId)
          .then((recipients) => {
            for (const uid of recipients) {
              if (uid === userId) continue;
              io.to(`user:${uid}`).emit(CHAT_SERVER_EVENTS.MESSAGE_READ, {
                contextType,
                contextId,
                userId,
                lastReadMessageId,
              });
            }
          })
          .catch((err) => logger.error({ err, userId }, 'message_read failed'));
      },
    );

    // Typing indicators are ephemeral — never persisted (SOCKET_EVENTS.md §5).
    const relayTyping = (event: string) => (raw: { contextType?: string; contextId?: string }) => {
      const { contextType, contextId } = raw ?? {};
      if ((contextType !== 'anon_session' && contextType !== 'friendship') || !contextId) return;
      void messagingService.recipients(contextType, contextId).then((recipients) => {
        for (const uid of recipients) {
          if (uid === userId) continue;
          io.to(`user:${uid}`).emit(event, { contextType, contextId, userId });
        }
      });
    };
    socket.on(CHAT_CLIENT_EVENTS.TYPING_START, relayTyping(CHAT_SERVER_EVENTS.TYPING_START));
    socket.on(CHAT_CLIENT_EVENTS.TYPING_STOP, relayTyping(CHAT_SERVER_EVENTS.TYPING_STOP));

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, userId, reason }, 'Socket disconnected');
      // Only clean up matching state when the user's LAST socket disconnects.
      const room = io.sockets.adapter.rooms.get(`user:${userId}`);
      if (!room || room.size === 0) {
        void matchingService.handleDisconnect(userId).catch((err) => {
          logger.error({ err, userId }, 'disconnect cleanup failed');
        });
      }
    });
  });

  matchingService.setServer(io);
  return io;
}
