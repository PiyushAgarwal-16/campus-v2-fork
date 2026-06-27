'use client';

import { useState } from 'react';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { useFriends } from '../../hooks/useFriends';
import { AppNav } from '../../components/AppNav';
import { Avatar } from '../../components/Avatar';
import { Chat } from '../../components/Chat';
import { Card, CardTitle, CardDescription } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

/**
 * Friend system surfaces (FRIEND_SYSTEM.md, UI_GUIDELINES.md §12): friends list
 * with persistent chat, incoming/outgoing requests, and blocked users. The chat
 * reuses the Phase 04 conversation component with revealed identities.
 */
export default function FriendsPage() {
  const { user, isLoading } = useRequireAuth();
  const {
    friends,
    incoming,
    outgoing,
    blocked,
    accept,
    reject,
    cancel,
    removeFriend,
    block,
    unblock,
  } = useFriends();
  const [openFriendshipId, setOpenFriendshipId] = useState<string | null>(null);

  if (isLoading || !user) return null;

  const openFriend = friends.find((f) => f.friendshipId === openFriendshipId);

  // Focused chat view: when a friend chat is open, show only the conversation
  // (the friends list and other sections are hidden to avoid clutter — Bug fix).
  if (openFriend) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-space-4 px-space-4 py-space-8 md:px-space-8">
        <AppNav />
        <div className="flex items-center justify-between gap-space-3 border-b border-border pb-space-3">
          <div className="flex items-center gap-space-2">
            <Button variant="ghost" size="sm" onClick={() => setOpenFriendshipId(null)}>
              ←
            </Button>
            <Avatar name={openFriend.user.name} mediaId={openFriend.user.avatarMediaId} size="sm" />
            <span className="text-body font-medium text-foreground">{openFriend.user.name}</span>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              void block(openFriend.user.id);
              setOpenFriendshipId(null);
            }}
          >
            Block
          </Button>
        </div>
        <div className="flex-1">
          <Chat contextType="friendship" contextId={openFriend.friendshipId} selfId={user.id} />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-space-6 px-space-4 py-space-8 md:px-space-8">
      <AppNav />
      <div className="flex flex-col gap-space-1">
        <h1 className="text-h1 text-foreground">Friends</h1>
        <p className="text-body text-muted-foreground">
          Connections you made on Campusly. Friend chats stay with you.
        </p>
      </div>

      {/* Incoming requests */}
      {incoming.length > 0 && (
        <section className="flex flex-col gap-space-3">
          <h2 className="text-h3 text-foreground">Requests</h2>
          {incoming.map((r) => (
            <Card key={r.requestId} className="flex items-center justify-between gap-space-3">
              <div className="flex items-center gap-space-3">
                <Avatar
                  name={r.fromUser?.name ?? '?'}
                  mediaId={r.fromUser?.avatarMediaId ?? null}
                />
                <div className="flex flex-col gap-space-1">
                  <span className="text-body text-foreground">
                    {r.fromUser ? r.fromUser.name : 'Someone from your chat'}
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {r.origin === 'session' ? 'From an anonymous chat' : 'Wants to be friends'}
                  </span>
                </div>
              </div>
              <div className="flex gap-space-2">
                <Button size="sm" onClick={() => void accept(r.requestId)}>
                  Accept
                </Button>
                <Button variant="secondary" size="sm" onClick={() => void reject(r.requestId)}>
                  Decline
                </Button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {/* Friends list */}
      <section className="flex flex-col gap-space-3">
        <h2 className="text-h3 text-foreground">Your friends</h2>
        {friends.length === 0 ? (
          <Card className="flex flex-col items-center gap-space-2 text-center">
            <CardTitle>No friends yet</CardTitle>
            <CardDescription>Start a match to meet someone new.</CardDescription>
          </Card>
        ) : (
          friends.map((f) => (
            <Card key={f.friendshipId} className="flex items-center justify-between gap-space-3">
              <div className="flex items-center gap-space-3">
                <Avatar name={f.user.name} mediaId={f.user.avatarMediaId} />
                <span className="text-body text-foreground">{f.user.name}</span>
              </div>
              <div className="flex gap-space-2">
                <Button size="sm" onClick={() => setOpenFriendshipId(f.friendshipId)}>
                  Message
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void removeFriend(f.friendshipId)}
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))
        )}
      </section>

      {/* Outgoing requests */}
      {outgoing.length > 0 && (
        <section className="flex flex-col gap-space-3">
          <h2 className="text-h3 text-foreground">Sent requests</h2>
          {outgoing.map((r) => (
            <Card key={r.requestId} className="flex items-center justify-between gap-space-3">
              <span className="text-body text-muted-foreground">
                {r.toUser ? r.toUser.name : 'Pending (anonymous)'}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void cancel(r.requestId)}>
                Cancel
              </Button>
            </Card>
          ))}
        </section>
      )}

      {/* Blocked users */}
      {blocked.length > 0 && (
        <section className="flex flex-col gap-space-3">
          <h2 className="text-h3 text-foreground">Blocked</h2>
          {blocked.map((b) => (
            <Card key={b.user.id} className="flex items-center justify-between gap-space-3">
              <span className="text-body text-muted-foreground">{b.user.name}</span>
              <Button variant="secondary" size="sm" onClick={() => void unblock(b.user.id)}>
                Unblock
              </Button>
            </Card>
          ))}
        </section>
      )}
    </main>
  );
}
