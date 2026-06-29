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
import { cn } from '../../lib/utils';

type FriendState = 'idle' | 'sent' | 'incoming' | 'accepted';

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

  const render3DOrbits = (isWaiting: boolean) => {
    const speedClass = isWaiting ? 'sphere-speed-fast' : 'sphere-speed-slow';
    return (
      <div className="relative h-72 w-full flex items-center justify-center overflow-hidden bg-transparent select-none">
        {/* Pulsing Vector Rings (Waiting state only) */}
        {isWaiting && (
          <>
            <div className="pulse-ring-beacon" />
            <div className="pulse-ring-beacon pulse-ring-beacon-2" />
          </>
        )}

        {/* 3D Wireframe Spinning Globe */}
        <div className={`sphere-3d ${speedClass} ${isWaiting ? 'sphere-active' : ''}`}>
          {/* Longitudinal Rings (Vertical) */}
          <div className="ring-3d ring-long-1" />
          <div className="ring-3d ring-long-2" />
          <div className="ring-3d ring-long-3" />
          <div className="ring-3d ring-long-4" />

          {/* Latitudinal Rings (Horizontal) */}
          <div className="ring-3d ring-lat-1" />
          <div className="ring-3d ring-lat-2" />
          <div className="ring-3d ring-lat-3" />
          <div className="ring-3d ring-lat-4" />
          <div className="ring-3d ring-lat-5" />

          {/* 3D Placed Nodes on the Sphere Surface */}
          <div className="node-3d node-1" />
          <div className="node-3d node-2" />
          <div className="node-3d node-3" />
          <div className="node-3d node-4" />
          <div className="node-3d node-5" />
        </div>

        {/* Central Signal Point */}
        <div className="absolute h-2.5 w-2.5 rounded-full bg-brand shadow-[0_0_8px_#FF9900]" />
      </div>
    );
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <style>{`
        .sphere-3d {
          position: relative;
          width: 200px;
          height: 200px;
          perspective: 1000px;
          transform-style: preserve-3d;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .pulse-ring-beacon {
          position: absolute;
          width: 200px;
          height: 200px;
          border-radius: 50%;
          border: 1px solid rgba(255, 153, 0, 0.25);
          animation: pulse-radar 2.5s cubic-bezier(0.1, 0.8, 0.3, 1) infinite;
          pointer-events: none;
        }

        .pulse-ring-beacon-2 {
          animation-delay: 1.25s;
        }

        @keyframes pulse-radar {
          0% { transform: scale(0.6); opacity: 0; }
          15% { opacity: 0.5; }
          85% { opacity: 0.1; }
          100% { transform: scale(1.4); opacity: 0; }
        }

        .sphere-speed-slow {
          animation: rotateSphere 18s linear infinite;
        }
        
        .sphere-speed-fast {
          animation: rotateSphere 4s linear infinite;
        }

        @keyframes rotateSphere {
          0% { transform: rotateX(20deg) rotateY(0deg) rotateZ(10deg); }
          100% { transform: rotateX(20deg) rotateY(360deg) rotateZ(10deg); }
        }

        .ring-3d {
          position: absolute;
          inset: 0;
          border: 1px solid rgba(255, 153, 0, 0.28);
          border-radius: 50%;
          transform-style: preserve-3d;
          backface-visibility: visible;
          transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }

        .dark .ring-3d {
          border-color: rgba(255, 153, 0, 0.14);
        }

        .sphere-active .ring-3d {
          border-color: rgba(255, 153, 0, 0.45);
          box-shadow: 0 0 10px rgba(255, 153, 0, 0.08);
        }

        .dark .sphere-active .ring-3d {
          border-color: rgba(255, 153, 0, 0.28);
          box-shadow: 0 0 12px rgba(255, 153, 0, 0.04);
        }

        /* Vertical Lines */
        .ring-long-1 { transform: rotateY(0deg); }
        .ring-long-2 { transform: rotateY(45deg); }
        .ring-long-3 { transform: rotateY(90deg); }
        .ring-long-4 { transform: rotateY(135deg); }

        /* Horizontal Lines */
        .ring-lat-1 {
          width: 120px;
          height: 120px;
          inset: auto;
          transform: translateY(-60px) rotateX(90deg);
        }
        .ring-lat-2 {
          width: 173px;
          height: 173px;
          inset: auto;
          transform: translateY(-30px) rotateX(90deg);
        }
        .ring-lat-3 {
          transform: rotateX(90deg);
        }
        .ring-lat-4 {
          width: 173px;
          height: 173px;
          inset: auto;
          transform: translateY(30px) rotateX(90deg);
        }
        .ring-lat-5 {
          width: 120px;
          height: 120px;
          inset: auto;
          transform: translateY(60px) rotateX(90deg);
        }

        /* 3D Nodes sitting on sphere bounds (Z-translated) */
        .node-3d {
          position: absolute;
          width: 6px;
          height: 6px;
          background: #FF9900;
          border-radius: 50%;
          box-shadow: 0 0 10px #FF9900;
          transform-style: preserve-3d;
        }
        
        .node-1 { transform: rotateY(35deg) rotateX(25deg) translateZ(100px); }
        .node-2 { transform: rotateY(115deg) rotateX(-15deg) translateZ(100px); }
        .node-3 { transform: rotateY(205deg) rotateX(35deg) translateZ(100px); }
        .node-4 { transform: rotateY(295deg) rotateX(-25deg) translateZ(100px); }
        .node-5 { transform: rotateY(155deg) rotateX(55deg) translateZ(100px); }
      `}</style>

      <div className={cn('shrink-0', state === 'in_session' ? 'hidden md:block' : '')}>
        <AppNav />
      </div>

      <div className="flex-1 overflow-hidden flex flex-col px-space-4 md:px-space-8 pb-24 md:pb-8">
        <div className="mx-auto max-w-5xl w-full flex-1 flex flex-col py-space-5 overflow-hidden">
          {state !== 'in_session' ? (
            <div className="flex-1 flex flex-col justify-center max-w-xl mx-auto w-full">
              <div className="flex flex-col gap-space-1 mb-space-8 text-center animate-fade-in">
                <h1 className="text-h1 text-foreground tracking-tight">Meet Someone</h1>
                <p className="text-body text-muted-foreground">
                  Anonymous pairing with another student.
                </p>
              </div>

              <Card className="flex flex-col items-center justify-center p-space-6 md:p-space-8 shadow-none border-0 bg-transparent">
                {state === 'idle' && (
                  <>
                    {render3DOrbits(false)}
                    <div className="flex flex-col gap-space-1 text-center mb-space-6">
                      <CardTitle>Ready when you are</CardTitle>
                      <CardDescription>
                        {endedReason === 'timeout'
                          ? 'No match found. Try again.'
                          : endedReason
                            ? 'Chat ended. Start another anytime.'
                            : 'Tap below to find someone.'}
                      </CardDescription>
                    </div>
                    <Button
                      size="lg"
                      className="w-full sm:w-auto px-space-8 shadow-sm hover:scale-[1.01] active:scale-95 transition-all select-none"
                      onClick={findMatch}
                    >
                      Find someone
                    </Button>
                  </>
                )}

                {state === 'waiting' && (
                  <>
                    {render3DOrbits(true)}
                    <div className="flex flex-col gap-space-1 text-center mb-space-6">
                      <CardTitle className="flex items-center gap-space-2 justify-center">
                        Searching<span className="animate-pulse">…</span>
                      </CardTitle>
                      <CardDescription>Looking for a match on your campus.</CardDescription>
                    </div>
                    <Button
                      variant="secondary"
                      className="w-full sm:w-auto px-space-8 active:scale-95 transition-all select-none"
                      onClick={cancel}
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </Card>
            </div>
          ) : (
            // Connected Chat Screen
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
                        <span className="text-body font-medium text-foreground">
                          Connected — anonymous
                        </span>
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
