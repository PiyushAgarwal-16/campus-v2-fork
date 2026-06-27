'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  FRIEND_SERVER_EVENTS,
  type FriendSummary,
  type IncomingFriendRequest,
  type OutgoingFriendRequest,
  type BlockedUserItem,
  type FriendRequestReceivedPayload,
  type FriendRequestAcceptedPayload,
  type FriendRemovedPayload,
} from '@campusly/shared-types';
import { connectSocket, getSocket } from '../lib/socket';
import { friendsApi } from '../lib/friends';

/**
 * Drives the friend surfaces (FRIEND_SYSTEM.md): friends list, incoming/outgoing
 * requests, and blocked users — loaded over REST, then kept fresh by the
 * friend socket events (SOCKET_EVENTS.md §8). Actions re-sync the affected list.
 */
export function useFriends() {
  const [friends, setFriends] = useState<FriendSummary[]>([]);
  const [incoming, setIncoming] = useState<IncomingFriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingFriendRequest[]>([]);
  const [blocked, setBlocked] = useState<BlockedUserItem[]>([]);

  const refreshFriends = useCallback(() => {
    void friendsApi.listFriends().then(setFriends);
  }, []);
  const refreshIncoming = useCallback(() => {
    void friendsApi.listIncoming().then(setIncoming);
  }, []);
  const refreshOutgoing = useCallback(() => {
    void friendsApi.listOutgoing().then(setOutgoing);
  }, []);
  const refreshBlocked = useCallback(() => {
    void friendsApi.listBlocked().then(setBlocked);
  }, []);

  const refreshAll = useCallback(() => {
    refreshFriends();
    refreshIncoming();
    refreshOutgoing();
    refreshBlocked();
  }, [refreshFriends, refreshIncoming, refreshOutgoing, refreshBlocked]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  // Live updates.
  useEffect(() => {
    const socket = connectSocket();

    const onReceived = (_p: FriendRequestReceivedPayload) => refreshIncoming();
    const onAccepted = (_p: FriendRequestAcceptedPayload) => {
      refreshFriends();
      refreshOutgoing();
    };
    const onRemoved = (_p: FriendRemovedPayload) => refreshFriends();

    socket.on(FRIEND_SERVER_EVENTS.FRIEND_REQUEST_RECEIVED, onReceived);
    socket.on(FRIEND_SERVER_EVENTS.FRIEND_REQUEST_ACCEPTED, onAccepted);
    socket.on(FRIEND_SERVER_EVENTS.FRIEND_REMOVED, onRemoved);

    return () => {
      socket.off(FRIEND_SERVER_EVENTS.FRIEND_REQUEST_RECEIVED, onReceived);
      socket.off(FRIEND_SERVER_EVENTS.FRIEND_REQUEST_ACCEPTED, onAccepted);
      socket.off(FRIEND_SERVER_EVENTS.FRIEND_REMOVED, onRemoved);
    };
  }, [refreshFriends, refreshIncoming, refreshOutgoing]);

  const accept = useCallback(
    async (requestId: string) => {
      await friendsApi.accept(requestId);
      refreshFriends();
      refreshIncoming();
    },
    [refreshFriends, refreshIncoming],
  );

  const reject = useCallback(
    async (requestId: string) => {
      await friendsApi.reject(requestId);
      refreshIncoming();
    },
    [refreshIncoming],
  );

  const cancel = useCallback(
    async (requestId: string) => {
      await friendsApi.cancel(requestId);
      refreshOutgoing();
    },
    [refreshOutgoing],
  );

  const removeFriend = useCallback(
    async (friendshipId: string) => {
      await friendsApi.removeFriend(friendshipId);
      refreshFriends();
    },
    [refreshFriends],
  );

  const block = useCallback(
    async (userId: string) => {
      await friendsApi.block(userId);
      refreshAll();
    },
    [refreshAll],
  );

  const unblock = useCallback(
    async (userId: string) => {
      await friendsApi.unblock(userId);
      refreshBlocked();
    },
    [refreshBlocked],
  );

  // Ensure a connection exists even if no live event has fired yet.
  useEffect(() => {
    getSocket();
  }, []);

  return {
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
    refreshAll,
  };
}
