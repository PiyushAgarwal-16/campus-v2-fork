import { io, type Socket } from 'socket.io-client';
import { clientEnv } from './env';

/**
 * Socket.IO client wrapper (TECH_STACK.md §6, SOCKET_EVENTS.md §1).
 * Phase 00: unauthenticated lazy singleton, manual connect. Phase 01 attaches
 * the JWT via `auth` and wires reconnection/auth handshake.
 */
let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(clientEnv.apiBaseUrl, {
      path: '/socket.io',
      autoConnect: false,
      transports: ['websocket'],
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
