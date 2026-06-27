'use client';

import { useState } from 'react';
import { REPORT_REASONS, type ReportReason } from '@campusly/shared-types';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { useMatching } from '../../hooks/useMatching';
import { apiFetch } from '../../lib/apiClient';
import { friendsApi } from '../../lib/friends';
import { AppNav } from '../../components/AppNav';
import { Chat } from '../../components/Chat';
import { Card, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

/**
 * Anonymous matching (MATCHING_ENGINE.md, implementation 03). Phase 03 delivers
 * pairing + session lifecycle; the in-session conversation arrives in Phase 04.
 */
export default function MatchPage() {
  const { user, isLoading } = useRequireAuth();
  const { state, sessionId, endedReason, findMatch, cancel, leaveSession } = useMatching();
  const [reporting, setReporting] = useState(false);
  const [friendRequest, setFriendRequest] = useState<'idle' | 'sent' | 'accepted'>('idle');

  if (isLoading || !user) return null;

  const addFriend = () => {
    if (!sessionId) return;
    void friendsApi
      .sendRequest({ origin: 'session', sessionId })
      .then((res) => setFriendRequest(res.status === 'accepted' ? 'accepted' : 'sent'))
      .catch(() => setFriendRequest('idle'));
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
                <Button
                  size="sm"
                  onClick={addFriend}
                  disabled={friendRequest !== 'idle'}
                  aria-label="Add friend"
                >
                  {friendRequest === 'accepted'
                    ? 'Friends'
                    : friendRequest === 'sent'
                      ? 'Request sent'
                      : 'Add friend'}
                </Button>
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
