/**
 * Anonymous matching contracts (MATCHING_ENGINE.md, SOCKET_EVENTS.md §4,
 * DATABASE_SCHEMA.md §7). Shared by api and web.
 */

/** Client → server socket events (commands). */
export const MATCH_CLIENT_EVENTS = {
  JOIN_QUEUE: 'join_queue',
  LEAVE_QUEUE: 'leave_queue',
  LEAVE_SESSION: 'leave_session',
  HEARTBEAT: 'heartbeat',
} as const;

/** Server → client socket events (facts/notifications). */
export const MATCH_SERVER_EVENTS = {
  QUEUE_STATUS: 'queue_status',
  MATCH_FOUND: 'match_found',
  MATCH_CANCELLED: 'match_cancelled',
  MATCH_TIMEOUT: 'match_timeout',
  SESSION_STARTED: 'session_started',
  SESSION_ENDED: 'session_ended',
} as const;

/** Matching lifecycle state as seen by a client (for status reconciliation). */
import type { PublicUserSummary } from './friends';
export type MatchState = 'idle' | 'waiting' | 'in_session';

export interface QueueStatusPayload {
  status: 'waiting';
  waitingCount?: number;
}

export interface MatchFoundPayload {
  sessionId: string;
}

export interface SessionStartedPayload {
  sessionId: string;
  startedAt: string;
  partner?: PublicUserSummary | null;
}

export type SessionEndReason = 'left' | 'disconnect' | 'expired' | 'reported';

export interface SessionEndedPayload {
  sessionId: string;
  reason: SessionEndReason;
}

export interface MatchCancelledPayload {
  reason: string;
}

/** GET /matching/status — current matching state (reconnection support). */
export interface MatchStatusResponse {
  state: MatchState;
  sessionId: string | null;
}

/** POST /matching/report — report a match partner. */
export const REPORT_REASONS = ['spam', 'harassment', 'hate', 'nsfw', 'safety', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportMatchInput {
  sessionId: string;
  reason: ReportReason;
  details?: string;
}

/** A row in GET /matching/history. */
export interface MatchHistoryItem {
  sessionId: string | null;
  durationSeconds: number | null;
  becameFriends: boolean;
  createdAt: string;
}
