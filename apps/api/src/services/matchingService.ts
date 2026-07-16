import type { Server as SocketIOServer } from 'socket.io';
import { MATCH_SERVER_EVENTS } from '@campusly/shared-types';
import { logger } from '../config/logger.js';
import { matchingRepository } from '../repositories/matchingRepository.js';
import { friendRepository } from '../repositories/friendRepository.js';
import { profileRepository } from '../repositories/profileRepository.js';
import { reportRepository } from '../repositories/reportRepository.js';
import { dataInspectorRepository } from '../repositories/dataInspectorRepository.js';
import { userRepository } from '../repositories/userRepository.js';

/**
 * Anonymous matching engine (MATCHING_ENGINE.md, ARCHITECTURE.md §5).
 *
 * The server is the SOLE authority. The live waiting pool is held in memory for
 * low-latency, race-free pairing (Node is single-threaded, so synchronous map
 * operations are atomic); the match_queue/anon_sessions tables provide
 * durability, recovery, and history. Pairing + session creation are
 * transactional, eliminating V1's ghost/duplicate sessions.
 */

interface WaitingEntry {
  universityId: string;
  enqueuedAt: number;
  lastHeartbeat: number;
  gender: string;
  genderPreference: string;
}

const STALE_MS = 30_000; // no heartbeat for 30s → reclaimed
const SWEEP_INTERVAL_MS = 15_000;

class MatchingService {
  private io: SocketIOServer | null = null;
  private waiting = new Map<string, WaitingEntry>();
  private sweeper: NodeJS.Timeout | null = null;

  /** Wire the Socket.IO server and start the stale-entry sweeper. */
  setServer(io: SocketIOServer): void {
    this.io = io;
    if (!this.sweeper) {
      this.sweeper = setInterval(() => this.sweepStale(), SWEEP_INTERVAL_MS);
      this.sweeper.unref?.();
    }
  }

  /** Stop the stale-entry sweeper (graceful shutdown). Idempotent. */
  stopSweeper(): void {
    if (!this.sweeper) return;
    clearInterval(this.sweeper);
    this.sweeper = null;
  }

  private emit(userId: string, event: string, payload: unknown): void {
    this.io?.to(`user:${userId}`).emit(event, payload);
  }

  /**
   * Recovery on startup (MATCHING_ENGINE.md §5.9): in-memory state begins empty,
   * so persisted waiting rows and orphaned active sessions are stale — clear them.
   */
  async recover(): Promise<void> {
    await matchingRepository.clearAllWaiting();
    await matchingRepository.expireAllActiveSessions();
    logger.info('Matching state recovered (cleared stale queue + active sessions)');
  }

  /** Checks if the user is already in an active session and re-emits SESSION_STARTED if so. */
  async checkSession(userId: string): Promise<boolean> {
    const active = await matchingRepository.getActiveSessionForUser(userId);
    if (!active) return false;

    this.emit(userId, MATCH_SERVER_EVENTS.SESSION_STARTED, {
      sessionId: active.sessionId,
      startedAt: active.startedAt.toISOString(),
    });
    return true;
  }

  /** A user requests a match. Pairs synchronously if a partner is waiting. */
  async joinQueue(userId: string, universityId: string, genderPreference = 'all'): Promise<void> {
    // Already in an active session? Re-notify (reconnection) instead of queueing.
    if (await this.checkSession(userId)) {
      return;
    }

    // Load user's own gender from profile
    const profile = await profileRepository.getProfile(userId);
    const userGender = profile?.gender ?? 'other';

    logger.info({ userId, userGender, genderPreference }, 'User enqueued request for matching');

    // Find the oldest compatible waiting partner (same campus, not self, not
    // blocked in either direction, and satisfying mutual gender preferences).
    const partnerId = await this.pickPartner(userId, universityId, userGender, genderPreference);

    if (!partnerId) {
      const now = Date.now();
      this.waiting.set(userId, {
        universityId,
        enqueuedAt: now,
        lastHeartbeat: now,
        gender: userGender,
        genderPreference,
      });
      await matchingRepository.upsertWaiting(userId, universityId);
      logger.info(
        { userId, totalWaiting: this.waiting.size },
        'No compatible partner waiting. Added to in-memory waiting pool.',
      );
      this.emit(userId, MATCH_SERVER_EVENTS.QUEUE_STATUS, {
        status: 'waiting',
        waitingCount: this.waiting.size,
      });
      return;
    }

    // Claim the partner synchronously (atomic in Node's single thread).
    const partnerEntry = this.waiting.get(partnerId);
    this.waiting.delete(partnerId);
    this.waiting.delete(userId);

    try {
      const session = await matchingRepository.createSession(universityId, userId, partnerId);
      const payload = { sessionId: session.id };

      let startedA: any = { sessionId: session.id, startedAt: session.startedAt.toISOString() };
      let startedB: any = { sessionId: session.id, startedAt: session.startedAt.toISOString() };

      const areFriends = await friendRepository.areFriends(userId, partnerId);
      if (areFriends) {
        const summaries = await userRepository.getPublicSummaries([userId, partnerId]);
        startedA.partner = summaries.get(partnerId);
        startedB.partner = summaries.get(userId);
      }

      this.emit(userId, MATCH_SERVER_EVENTS.MATCH_FOUND, payload);
      this.emit(partnerId, MATCH_SERVER_EVENTS.MATCH_FOUND, payload);
      this.emit(userId, MATCH_SERVER_EVENTS.SESSION_STARTED, startedA);
      this.emit(partnerId, MATCH_SERVER_EVENTS.SESSION_STARTED, startedB);

      logger.info(
        { sessionId: session.id, userA: userId, userB: partnerId, areFriends },
        'Symmetric match found! Session created.',
      );
    } catch (err) {
      // Roll back the claim: re-queue the partner so they are not stranded.
      logger.error({ err }, 'Session creation failed; re-queuing partner');
      const now = Date.now();
      this.waiting.set(partnerId, {
        universityId,
        enqueuedAt: now,
        lastHeartbeat: now,
        gender: partnerEntry?.gender ?? 'other',
        genderPreference: partnerEntry?.genderPreference ?? 'all',
      });
      this.emit(userId, MATCH_SERVER_EVENTS.MATCH_CANCELLED, { reason: 'pairing_failed' });
    }
  }

  private async pickPartner(
    userId: string,
    _universityId: string,
    userGender: string,
    genderPreference: string,
  ): Promise<string | null> {
    // Oldest-first candidates (broadly FIFO fairness).
    // Universal mode: no campus filter — cross-campus matching enabled.
    // Campus-scoping will be re-added as a premium feature.
    const candidates: { id: string; enqueuedAt: number }[] = [];
    for (const [id, entry] of this.waiting) {
      if (id === userId) continue;

      // Symmetric gender matching:
      // 1. Does the candidate's gender match the enqueuer's preference?
      if (genderPreference !== 'all' && entry.gender !== genderPreference) {
        continue;
      }
      // 2. Does the enqueuer's gender match the candidate's preference?
      if (entry.genderPreference !== 'all' && userGender !== entry.genderPreference) {
        continue;
      }

      candidates.push({ id, enqueuedAt: entry.enqueuedAt });
    }
    candidates.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    for (const candidate of candidates) {
      // Skip pairs where either user has blocked the other.
      if (!(await friendRepository.isBlockedEitherWay(userId, candidate.id))) {
        return candidate.id;
      }
    }
    return null;
    // NOTE: recent-match de-prioritization (matchingRepository.wereRecentlyMatched)
    // is a documented refinement (MATCHING_ENGINE.md §4) deferred to keep pairing
    // synchronous and race-free at MVP scale.
  }

  /** User cancels waiting. */
  async leaveQueue(userId: string): Promise<void> {
    this.waiting.delete(userId);
    await matchingRepository.removeFromQueue(userId);
  }

  /** Liveness ping — refreshes the in-memory heartbeat (no DB write amplification). */
  heartbeat(userId: string): void {
    const entry = this.waiting.get(userId);
    if (entry) entry.lastHeartbeat = Date.now();
  }

  /** User explicitly leaves an active session. */
  async leaveSession(sessionId: string, userId: string): Promise<void> {
    const isParticipant = await matchingRepository.isParticipant(sessionId, userId);
    if (!isParticipant) return;
    await this.endSession(sessionId, 'left');
  }

  /** Socket disconnect: clean up queue membership and end any active session. */
  async handleDisconnect(userId: string): Promise<void> {
    this.waiting.delete(userId);
    await matchingRepository.removeFromQueue(userId);
    const active = await matchingRepository.getActiveSessionForUser(userId);
    if (active) await this.endSession(active.sessionId, 'disconnect');
  }

  /** Ends a session and notifies both participants. */
  async endSession(
    sessionId: string,
    reason: 'left' | 'disconnect' | 'expired' | 'reported',
  ): Promise<void> {
    const result = await matchingRepository.endSession(sessionId, reason);
    if (!result) return;
    for (const uid of result.participants) {
      this.emit(uid, MATCH_SERVER_EVENTS.SESSION_ENDED, { sessionId, reason });
    }
  }

  /**
   * Report a match partner (accountable anonymity — MATCHING_ENGINE.md §7).
   * Ends the session immediately. Full report persistence + moderator review
   * arrive with the Moderation module (Phase 12); for now the report is logged
   * with the verified reporter identity for accountability.
   */
  async reportMatch(
    sessionId: string,
    reporterId: string,
    reason: string,
    details?: string,
  ): Promise<void> {
    const isParticipant = await matchingRepository.isParticipant(sessionId, reporterId);
    if (!isParticipant) return;

    logger.warn(
      { event: 'match_report', sessionId, reporterId, reason, details },
      'Anonymous session reported',
    );

    // 1. Resolve the reported match partner (targetId) from the session participants
    const participants = await matchingRepository.getParticipants(sessionId);
    const targetId = participants.find((id) => id !== reporterId);
    if (!targetId) {
      logger.error({ sessionId, reporterId }, 'No target match partner found for report');
      await this.endSession(sessionId, 'reported');
      return;
    }

    // 2. Capture the conversation transcript BEFORE ending/purging the session
    const transcript = await dataInspectorRepository.readConversationWindow({
      contextType: 'anon_session',
      conversationId: sessionId,
      limit: 50,
    });

    // 3. Serialize the transcript into the details field as JSON
    const reportDetails = JSON.stringify({
      userDetails: details ?? null,
      source: 'anon_chat',
      sessionId,
      transcript,
    });

    // 4. Persist the report
    await reportRepository.create({
      reporterId,
      targetType: 'user',
      targetId,
      reason: reason as any,
      details: reportDetails,
    });

    // 5. Terminate the session
    await this.endSession(sessionId, 'reported');
  }

  /** Periodic sweep: reclaim waiting users whose heartbeat went stale. */
  private sweepStale(): void {
    const cutoff = Date.now() - STALE_MS;
    for (const [userId, entry] of this.waiting) {
      if (entry.lastHeartbeat < cutoff) {
        this.waiting.delete(userId);
        void matchingRepository.removeFromQueue(userId);
        this.emit(userId, MATCH_SERVER_EVENTS.MATCH_TIMEOUT, {});
      }
    }
  }
}

export const matchingService = new MatchingService();
