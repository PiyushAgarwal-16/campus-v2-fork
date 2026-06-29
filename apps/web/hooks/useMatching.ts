'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MATCH_CLIENT_EVENTS,
  MATCH_SERVER_EVENTS,
  type MatchState,
  type MatchFoundPayload,
  type SessionStartedPayload,
  type SessionEndedPayload,
} from '@campusly/shared-types';
import { connectSocket, getSocket } from '../lib/socket';
import type { PublicUserSummary } from '@campusly/shared-types';

/**
 * Client state machine for anonymous matching (SOCKET_EVENTS.md §4).
 * Wires the authenticated socket to a simple idle → waiting → in_session model
 * and sends periodic heartbeats while waiting (MATCHING_ENGINE.md §5.2).
 */
export function useMatching() {
  const [state, setState] = useState<MatchState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [partner, setPartner] = useState<PublicUserSummary | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const heartbeat = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHeartbeat = useCallback(() => {
    if (heartbeat.current) {
      clearInterval(heartbeat.current);
      heartbeat.current = null;
    }
  }, []);

  useEffect(() => {
    const socket = connectSocket();

    const onQueue = () => {
      setState('waiting');
      setEndedReason(null);
    };
    const onFound = (_p: MatchFoundPayload) => setEndedReason(null);
    const onStarted = (p: SessionStartedPayload) => {
      stopHeartbeat();
      setSessionId(p.sessionId);
      setPartner(p.partner ?? null);
      setState('in_session');
    };
    const onEnded = (p: SessionEndedPayload) => {
      setSessionId(null);
      setPartner(null);
      setState('idle');
      setEndedReason(p.reason);
    };
    const onTimeout = () => {
      stopHeartbeat();
      setState('idle');
      setEndedReason('timeout');
    };
    const onCancelled = () => {
      stopHeartbeat();
      setState('idle');
    };

    socket.on(MATCH_SERVER_EVENTS.QUEUE_STATUS, onQueue);
    socket.on(MATCH_SERVER_EVENTS.MATCH_FOUND, onFound);
    socket.on(MATCH_SERVER_EVENTS.SESSION_STARTED, onStarted);
    socket.on(MATCH_SERVER_EVENTS.SESSION_ENDED, onEnded);
    socket.on(MATCH_SERVER_EVENTS.MATCH_TIMEOUT, onTimeout);
    socket.on(MATCH_SERVER_EVENTS.MATCH_CANCELLED, onCancelled);

    return () => {
      socket.off(MATCH_SERVER_EVENTS.QUEUE_STATUS, onQueue);
      socket.off(MATCH_SERVER_EVENTS.MATCH_FOUND, onFound);
      socket.off(MATCH_SERVER_EVENTS.SESSION_STARTED, onStarted);
      socket.off(MATCH_SERVER_EVENTS.SESSION_ENDED, onEnded);
      socket.off(MATCH_SERVER_EVENTS.MATCH_TIMEOUT, onTimeout);
      socket.off(MATCH_SERVER_EVENTS.MATCH_CANCELLED, onCancelled);
      stopHeartbeat();
    };
  }, [stopHeartbeat]);

  const findMatch = useCallback(() => {
    const socket = getSocket();
    setEndedReason(null);
    setState('waiting');
    socket.emit(MATCH_CLIENT_EVENTS.JOIN_QUEUE);
    stopHeartbeat();
    heartbeat.current = setInterval(() => socket.emit(MATCH_CLIENT_EVENTS.HEARTBEAT), 10_000);
  }, [stopHeartbeat]);

  const cancel = useCallback(() => {
    getSocket().emit(MATCH_CLIENT_EVENTS.LEAVE_QUEUE);
    stopHeartbeat();
    setState('idle');
  }, [stopHeartbeat]);

  const leaveSession = useCallback(() => {
    if (sessionId) getSocket().emit(MATCH_CLIENT_EVENTS.LEAVE_SESSION, { sessionId });
    setState('idle');
    setSessionId(null);
  }, [sessionId]);

  return { state, sessionId, partner, endedReason, findMatch, cancel, leaveSession };
}
