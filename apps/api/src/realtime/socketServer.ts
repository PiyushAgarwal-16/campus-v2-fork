import type { Server as HttpServer } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { config } from '../config/env.js';
import { logger } from '../config/logger.js';
import { tokenService } from '../services/tokenService.js';

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
    // Join the per-user room for notifications and friend-status fan-out.
    void socket.join(`user:${userId}`);
    logger.info({ socketId: socket.id, userId }, 'Socket authenticated and connected');

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, userId, reason }, 'Socket disconnected');
    });
  });

  return io;
}
