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
import { Globe3D } from '../../components/Globe3D';
import { Avatar } from '../../components/Avatar';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { cn } from '../../lib/utils';

type FriendState = 'idle' | 'sent' | 'incoming' | 'accepted';

export default function MatchPage() {
  const { user, isLoading } = useRequireAuth();
  const { state, sessionId, partner, findMatch, cancel, leaveSession } = useMatching();
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
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <div className={cn('shrink-0', state === 'in_session' ? 'hidden md:block' : '')}>
        <AppNav />
      </div>

      <div className="flex-1 overflow-hidden flex flex-col px-space-4 md:px-space-8 pb-24 md:pb-8">
        <div className="mx-auto max-w-5xl w-full flex-1 flex flex-col py-space-5 overflow-hidden">
          {state !== 'in_session' ? (
            /* ── Idle / Waiting: Globe + Button only ── */
            <div className="flex-1 flex flex-col items-center justify-center max-w-xl mx-auto w-full select-none">
              {/* 3D Globe Canvas */}
              <div className="w-full aspect-square max-w-[420px] mb-space-6">
                <Globe3D isSearching={state === 'waiting'} className="h-full" />
              </div>

              {/* Action Button */}
              {state === 'idle' && (
                <Button
                  size="lg"
                  className="w-full sm:w-auto min-w-[220px] px-space-8 py-4 text-lg font-semibold rounded-full shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-95 transition-all"
                  onClick={findMatch}
                >
                  Find a match
                </Button>
              )}

              {state === 'waiting' && (
                <div className="flex flex-col items-center gap-space-4">
                  <p className="text-caption text-muted-foreground animate-pulse tracking-wide">
                    Searching…
                  </p>
                  <Button
                    variant="secondary"
                    className="min-w-[180px] px-space-8 rounded-full active:scale-95 transition-all"
                    onClick={cancel}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          ) : (
            /* ── Connected Chat Screen ── */
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex flex-col gap-space-1 mb-space-4 shrink-0">
                <h1 className="text-h1 text-foreground">Meet Someone</h1>
              </div>

              <Card className="flex flex-col overflow-hidden flex-1 p-space-4 md:p-space-5 border-border/60">
                {sessionId && (
                  <div className="flex w-full flex-col h-full overflow-hidden">
                    {/* Chat Header */}
                    <div className="flex items-center justify-between gap-space-3 border-b border-divider pb-space-3 shrink-0">
                      <div className="flex items-center gap-space-2 select-none">
                        <span className="inline-block h-2.5 w-2.5 rounded-full bg-success animate-pulse" />
                        {partner ? (
                          <div className="flex items-center gap-space-2">
                            <Avatar name={partner.name} mediaId={partner.avatarMediaId} size="sm" />
                            <span className="text-body font-medium text-foreground flex items-center gap-1">
                              {partner.name}
                              <span className="text-small text-brand font-semibold">(Friend)</span>
                            </span>
                          </div>
                        ) : (
                          <span className="text-body font-medium text-foreground">
                            Connected — anonymous
                          </span>
                        )}
                      </div>
                      <div className="flex gap-space-2">
                        {friendState === 'incoming' ? (
                          <Button
                            size="sm"
                            onClick={acceptFriend}
                            aria-label="Accept friend request"
                          >
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

                    {/* Report popup */}
                    {reporting && (
                      <div className="flex flex-wrap justify-center gap-space-2 py-space-3 border-b border-divider bg-surface/30 shrink-0">
                        {REPORT_REASONS.map((r) => (
                          <Button key={r} variant="danger" size="sm" onClick={() => report(r)}>
                            {r}
                          </Button>
                        ))}
                      </div>
                    )}

                    {/* Active Chat box (scrolls internally) */}
                    <div className="flex-1 overflow-hidden min-h-0 mt-space-2">
                      <Chat contextType="anon_session" contextId={sessionId} selfId={user.id} />
                    </div>
                  </div>
                )}
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
