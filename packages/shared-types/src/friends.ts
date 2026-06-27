import { z } from 'zod';

/**
 * Friend system contracts (FRIEND_SYSTEM.md, DATABASE_SCHEMA.md §9,
 * SOCKET_EVENTS.md §8, API_SPEC.md §6). Friend actions are REST commands;
 * their real-time notifications flow over sockets to the affected user rooms.
 */

export const FRIEND_REQUEST_ORIGINS = ['session', 'profile', 'community'] as const;
export type FriendRequestOrigin = (typeof FRIEND_REQUEST_ORIGINS)[number];

export const FRIEND_REQUEST_STATUSES = ['pending', 'accepted', 'rejected', 'cancelled'] as const;
export type FriendRequestStatus = (typeof FRIEND_REQUEST_STATUSES)[number];

/** Minimal public identity revealed once a friendship is consensual. */
export interface PublicUserSummary {
  id: string;
  name: string;
  universityId: string;
  year: number | null;
  avatarMediaId: string | null;
}

/** A friend in the user's friend list. */
export interface FriendSummary {
  friendshipId: string;
  user: PublicUserSummary;
  since: string;
}

/**
 * An incoming pending request. `fromUser` is null while the requester remains
 * anonymous (session-origin requests stay anonymous until acceptance — §8).
 */
export interface IncomingFriendRequest {
  requestId: string;
  origin: FriendRequestOrigin | null;
  fromUser: PublicUserSummary | null;
  createdAt: string;
}

/** An outgoing pending request. `toUser` is null for anonymous session origin. */
export interface OutgoingFriendRequest {
  requestId: string;
  origin: FriendRequestOrigin | null;
  toUser: PublicUserSummary | null;
  createdAt: string;
}

/** A user the current user has blocked. */
export interface BlockedUserItem {
  user: PublicUserSummary;
  createdAt: string;
}

// --- Request schemas ---

/**
 * POST /friends/requests. Either a direct `receiverId` (profile/community
 * origin, identity known) or a `sessionId` (session origin — the server
 * resolves the anonymous partner so the client never learns their id).
 */
export const SendFriendRequestSchema = z
  .object({
    origin: z.enum(FRIEND_REQUEST_ORIGINS),
    receiverId: z.string().uuid().optional(),
    sessionId: z.string().uuid().optional(),
  })
  .refine(
    (v) =>
      v.origin === 'session'
        ? Boolean(v.sessionId) && !v.receiverId
        : Boolean(v.receiverId) && !v.sessionId,
    { message: 'session origin requires sessionId; other origins require receiverId' },
  );
export type SendFriendRequestInput = z.infer<typeof SendFriendRequestSchema>;

/** POST /friends/block — block a user (severs all contact bidirectionally). */
export const BlockUserSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});
export type BlockUserInput = z.infer<typeof BlockUserSchema>;

// --- Socket events (server → client; all friend commands are REST) ---

export const FRIEND_SERVER_EVENTS = {
  FRIEND_REQUEST_SENT: 'friend_request_sent',
  FRIEND_REQUEST_RECEIVED: 'friend_request_received',
  FRIEND_REQUEST_ACCEPTED: 'friend_request_accepted',
  FRIEND_REMOVED: 'friend_removed',
  USER_BLOCKED: 'user_blocked',
} as const;

export interface FriendRequestSentPayload {
  requestId: string;
  receiverId: string;
}

export interface FriendRequestReceivedPayload {
  requestId: string;
  origin: FriendRequestOrigin | null;
  fromUser: PublicUserSummary | null;
}

export interface FriendRequestAcceptedPayload {
  friendshipId: string;
  user: PublicUserSummary;
}

export interface FriendRemovedPayload {
  friendshipId: string;
}

export interface UserBlockedPayload {
  blockedUserId: string;
}
