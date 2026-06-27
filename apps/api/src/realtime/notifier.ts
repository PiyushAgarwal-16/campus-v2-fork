import type { Server as SocketIOServer } from 'socket.io';

/**
 * Thin realtime notifier (SOCKET_EVENTS.md §8). REST commands (friend requests,
 * blocks, etc.) change state, then push fact notifications to the affected
 * users' rooms so their UIs update instantly. Holds the single io instance,
 * set once at server creation; emits are no-ops until then (safe under tests).
 */
class Notifier {
  private io: SocketIOServer | null = null;

  setServer(io: SocketIOServer): void {
    this.io = io;
  }

  /** Emit an event to a single user's room (`user:<id>`). */
  emitToUser(userId: string, event: string, payload: unknown): void {
    this.io?.to(`user:${userId}`).emit(event, payload);
  }
}

export const notifier = new Notifier();
