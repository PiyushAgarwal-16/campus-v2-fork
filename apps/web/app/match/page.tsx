'use client';

import { useEffect, useState } from 'react';
import {
  REPORT_REASONS,
  FRIEND_SERVER_EVENTS,
  type ReportReason,
  type FriendRequestReceivedPayload,
} from '@campusly/shared-types';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { useMatching } from '../../hooks/useMatching';
import { apiFetch } from '../../lib/apiClient';
import { friendsApi } from '../../lib/friends';
import { getSocket } from '../../lib/socket';
import { AppNav } from '../../components/AppNav';
import { Chat } from '../../components/Chat';
import { Card, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

type FriendState = 'idle' | 'sent' | 'incoming' | 'accepted';

/**
 * Anonymous matching (MATCHING_ENGINE.md, implementation 03). Pairing + session
 * lifecycle, in-session chat, and the friend-request bridge (FRIEND_SYSTEM.md §8):
 * either party can offer friendship; the other can accept right here.
 */
export default function MatchPage() {
  const { user, isLoading } = useRequireAuth();
  const { state, sessionId, endedReason, findMatch, cancel, leaveSession } = useMatching();
  const [reporting, setReporting] = useState(false);
  const [friendState, setFriendState] = useState<FriendState>('idle');
  const [incomingRequestId, setIncomingRequestId] = useState<string | null>(null);

  // Reset friend UI whenever the session changes.
  useEffect(() => {
    setFriendState('idle');
    setIncomingRequestId(null);
  }, [sessionId]);

  // Listen for the partner's friend request / acceptance during the session.
  useEffect(() => {
    if (!sessionId) return;
    const socket = getSocket();
    const onReceived = (p: FriendRequestReceivedPayload) => {
      if (p.origin === 'session') {
        setIncomingRequestId(p.requestId);
        setFriendState((s) => (s === 'sent' || s === 'accepted' ? s : 'incoming'));
      }
    };
    const onAccepted = () => setFriendState('accepted');
    socket.on(FRIEND_SERVER_EVENTS.FRIEND_REQUEST_RECEIVED, onReceived);
    socket.on(FRIEND_SERVER_EVENTS.FRIEND_REQUEST_ACCEPTED, onAccepted);
    return () => {
      socket.off(FRIEND_SERVER_EVENTS.FRIEND_REQUEST_RECEIVED, onReceived);
      socket.off(FRIEND_SERVER_EVENTS.FRIEND_REQUEST_ACCEPTED, onAccepted);
    };
  }, [sessionId]);

  if (isLoading || !user) return null;

  const addFriend = () => {
    if (!sessionId) return;
    void friendsApi
      .sendRequest({ origin: 'session', sessionId })
      .then((res) => setFriendState(res.status === 'accepted' ? 'accepted' : 'sent'))
      .catch(() => setFriendState('idle'));
  };

  const acceptFriend = () => {
    if (!incomingRequestId) return;
    void friendsApi
      .accept(incomingRequestId)
      .then(() => setFriendState('accepted'))
      .catch(() => setFriendState('incoming'));
  };

  const report = (reason: ReportReason) => {
    if (!sessionId) return;
    void apiFetch('/matching/report', {
      method: 'POST',
      body: JSON.stringify({ sessionId, reason }),
    }).finally(() => {
      setReporting(false);
      leaveSession();
    });
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-space-6 px-space-4 py-space-8 md:px-space-8">
      <AppNav />
      <div className="flex flex-col gap-space-1">
        <h1 className="text-h1 text-foreground">Meet someone</h1>
        <p className="text-body text-muted-foreground">
          Get paired with another verified student for an anonymous chat. Zero pressure — leave
          anytime.
        </p>
      </div>

      <Card className="flex min-h-64 flex-col items-center justify-center gap-space-6 text-center">
        {state === 'idle' && (
          <>
            <div className="flex flex-col gap-space-1">
              <CardTitle>Ready when you are</CardTitle>
              <CardDescription>
                {endedReason === 'timeout'
                  ? 'No match found this time. Try again.'
                  : endedReason
                    ? 'Your chat ended. Start another anytime.'
                    : 'Tap below to find someone on your campus.'}
              </CardDescription>
            </div>
            <Button size="lg" onClick={findMatch}>
              Find someone
            </Button>
          </>
        )}

        {state === 'waiting' && (
          <>
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-brand" />
            <div className="flex flex-col gap-space-1">
              <CardTitle>Looking for someone…</CardTitle>
              <CardDescription>This usually takes just a few seconds.</CardDescription>
            </div>
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          </>
        )}

        {state === 'in_session' && sessionId && (
          <div className="flex w-full flex-col gap-space-4">
            <div className="flex items-center justify-between gap-space-3 border-b border-border pb-space-3">
              <div className="flex items-center gap-space-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-success" />
                <span className="text-body text-foreground">Connected — anonymous</span>
              </div>
              <div className="flex gap-space-2">
                {friendState === 'incoming' ? (
                  <Button size="sm" onClick={acceptFriend} aria-label="Accept friend request">
                    Accept request
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={addFriend}
                    disabled={friendState !== 'idle'}
                    aria-label="Add friend"
                  >
                    {friendState === 'accepted'
                      ? 'Friends'
                      : friendState === 'sent'
                        ? 'Request sent'
                        : 'Add friend'}
                  </Button>
                )}
                <Button variant="secondary" size="sm" onClick={leaveSession}>
                  Leave
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setReporting((v) => !v)}>
                  Report
                </Button>
              </div>
            </div>

            {reporting && (
              <div className="flex flex-wrap justify-center gap-space-2">
                {REPORT_REASONS.map((r) => (
                  <Button key={r} variant="danger" size="sm" onClick={() => report(r)}>
                    {r}
                  </Button>
                ))}
              </div>
            )}

            <div className="h-96">
              <Chat contextType="anon_session" contextId={sessionId} selfId={user.id} />
            </div>
          </div>
        )}
      </Card>
    </main>
  );
}
