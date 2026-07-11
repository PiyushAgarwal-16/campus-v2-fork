import type {
  FriendRequestOrigin,
  FriendSummary,
  IncomingFriendRequest,
  OutgoingFriendRequest,
  BlockedUserItem,
  PublicUserSummary,
  SendFriendRequestInput,
} from '@campusly/shared-types';
import { FRIEND_SERVER_EVENTS } from '@campusly/shared-types';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../domain/errors.js';
import { friendRepository } from '../repositories/friendRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { profileRepository } from '../repositories/profileRepository.js';
import { matchingRepository } from '../repositories/matchingRepository.js';
import { notifier } from '../realtime/notifier.js';
import { notificationService } from './notificationService.js';
import { logger } from '../config/logger.js';

/**
 * Friend system business logic (FRIEND_SYSTEM.md). Requests, acceptance,
 * removal, and blocking are commands here; real-time notifications fan out to
 * the affected user rooms (SOCKET_EVENTS.md §8). Identity reveal is mutual and
 * happens only on acceptance — session-origin requests stay anonymous (§8).
 */

const REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // re-request cooldown after a rejection
const MAX_PENDING_OUTGOING = 50; // spam-resistance cap on outstanding sent requests

function toSummary(s: {
  id: string;
  name: string;
  username: string | null;
  universityId: string;
  year: number | null;
  avatarMediaId: string | null;
}): PublicUserSummary {
  return {
    id: s.id,
    name: s.name,
    username: s.username,
    universityId: s.universityId,
    year: s.year,
    avatarMediaId: s.avatarMediaId,
  };
}

export const friendService = {
  /**
   * Send a friend request. Resolves the recipient (session origin uses the
   * anonymous partner), enforces consent/limits/cooldown, and auto-accepts when
   * the recipient already has a pending request to the sender (mutual intent).
   */
  async sendRequest(
    senderId: string,
    input: SendFriendRequestInput,
  ): Promise<{ requestId?: string; friendshipId?: string; status: 'pending' | 'accepted' }> {
    const receiverId = await this.resolveReceiver(senderId, input);

    if (receiverId === senderId) {
      throw new ValidationError('You cannot send a friend request to yourself.');
    }
    if (await friendRepository.isBlockedEitherWay(senderId, receiverId)) {
      throw new ForbiddenError('This request cannot be sent.');
    }
    if (await friendRepository.areFriends(senderId, receiverId)) {
      throw new ConflictError('You are already friends.');
    }

    // Mutual intent → immediate acceptance (FRIEND_SYSTEM.md §3).
    const pending = await friendRepository.findPendingBetween(senderId, receiverId);
    if (pending) {
      if (pending.senderId === senderId) {
        throw new ConflictError('You already have a pending request to this user.');
      }
      // The other user already requested us — accept theirs now.
      const friendship = await this.finalizeAcceptance(pending.id, senderId, receiverId);
      return { friendshipId: friendship.id, status: 'accepted' };
    }

    // Recipient consent (privacy setting) and campus scope.
    await this.assertRecipientAcceptsRequests(senderId, receiverId);

    // Rejection cooldown.
    const lastRejection = await friendRepository.lastRejectionAt(senderId, receiverId);
    if (lastRejection && Date.now() - lastRejection.getTime() < REJECTION_COOLDOWN_MS) {
      throw new ForbiddenError('You recently requested this person. Please try again later.');
    }

    // Pending-outgoing cap.
    if ((await friendRepository.countPendingOutgoing(senderId)) >= MAX_PENDING_OUTGOING) {
      throw new ForbiddenError('You have too many pending requests. Resolve some first.');
    }

    const origin: FriendRequestOrigin = input.origin;
    const request = await friendRepository.createRequest(senderId, receiverId, origin);

    // Notify the recipient (anonymous for session origin — no identity leak).
    let fromUser: PublicUserSummary | null = null;
    if (origin !== 'session') {
      const summaries = await userRepository.getPublicSummaries([senderId]);
      const s = summaries.get(senderId);
      fromUser = s ? toSummary(s) : null;
    }
    notifier.emitToUser(receiverId, FRIEND_SERVER_EVENTS.FRIEND_REQUEST_RECEIVED, {
      requestId: request.id,
      origin,
      fromUser,
    });
    // Persistent in-app notification (anonymous name for session origin).
    void notificationService.friendRequest(receiverId, fromUser?.name ?? null);

    return { requestId: request.id, status: 'pending' };
  },

  /** Resolves the receiver id; session origin maps to the anonymous partner. */
  async resolveReceiver(senderId: string, input: SendFriendRequestInput): Promise<string> {
    if (input.origin === 'session') {
      const sessionId = input.sessionId as string;
      const participants = await matchingRepository.getParticipants(sessionId);
      if (!participants.includes(senderId)) {
        throw new ForbiddenError('You are not part of that session.');
      }
      const other = participants.find((id) => id !== senderId);
      if (!other) throw new NotFoundError('No partner found for that session.');
      return other;
    }
    const receiverId = input.receiverId as string;
    const receiver = await userRepository.findById(receiverId);
    if (!receiver || receiver.deletedAt) throw new NotFoundError('That user was not found.');
    return receiverId;
  },

  /** Enforces the recipient's `allow_friend_requests` policy (FRIEND_SYSTEM.md §3). */
  async assertRecipientAcceptsRequests(senderId: string, receiverId: string): Promise<void> {
    const privacy = await profileRepository.getPrivacy(receiverId);
    const policy = privacy?.allowFriendRequests ?? 'everyone';
    if (policy === 'none') {
      throw new ForbiddenError('This user is not accepting friend requests.');
    }
    if (policy === 'campus') {
      const [sender, receiver] = await Promise.all([
        userRepository.findById(senderId),
        userRepository.findById(receiverId),
      ]);
      if (!sender || !receiver || sender.universityId !== receiver.universityId) {
        throw new ForbiddenError('This user only accepts requests from their campus.');
      }
    }
  },

  /** Accept a pending request addressed to the current user. */
  async accept(userId: string, requestId: string): Promise<{ friendshipId: string }> {
    const request = await friendRepository.findRequestById(requestId);
    if (!request || request.status !== 'pending') {
      throw new NotFoundError('That request is no longer available.');
    }
    if (request.receiverId !== userId) {
      throw new ForbiddenError('You cannot accept this request.');
    }
    if (await friendRepository.isBlockedEitherWay(request.senderId, userId)) {
      throw new ForbiddenError('That request cannot be accepted.');
    }
    const friendship = await this.finalizeAcceptance(requestId, userId, request.senderId);
    return { friendshipId: friendship.id };
  },

  /**
   * Shared acceptance path: create/revive the friendship, reveal identities to
   * both parties over sockets, and record the match→friend conversion.
   */
  async finalizeAcceptance(requestId: string, accepterId: string, otherId: string) {
    const friendship = await friendRepository.acceptRequest(requestId, accepterId, otherId);

    const summaries = await userRepository.getPublicSummaries([accepterId, otherId]);
    const accepter = summaries.get(accepterId);
    const other = summaries.get(otherId);
    // Reveal each user's identity to the other (mutual consent — FRIEND_SYSTEM.md §4).
    if (other) {
      notifier.emitToUser(accepterId, FRIEND_SERVER_EVENTS.FRIEND_REQUEST_ACCEPTED, {
        friendshipId: friendship.id,
        user: toSummary(other),
      });
    }
    if (accepter) {
      notifier.emitToUser(otherId, FRIEND_SERVER_EVENTS.FRIEND_REQUEST_ACCEPTED, {
        friendshipId: friendship.id,
        user: toSummary(accepter),
      });
    }

    // Tell the original requester their request was accepted (persistent).
    void notificationService.friendAccepted(otherId, accepter?.name ?? 'Someone', friendship.id);

    // Record the conversion for the match→friend metric (best-effort).
    void matchingRepository
      .markBecameFriends(accepterId, otherId)
      .catch((err) => logger.error({ err }, 'markBecameFriends failed'));

    return friendship;
  },

  /** Reject a pending request addressed to the current user (starts cooldown). */
  async reject(userId: string, requestId: string): Promise<void> {
    const request = await friendRepository.findRequestById(requestId);
    if (!request || request.status !== 'pending') {
      throw new NotFoundError('That request is no longer available.');
    }
    if (request.receiverId !== userId) {
      throw new ForbiddenError('You cannot reject this request.');
    }
    await friendRepository.setRequestStatus(requestId, 'rejected');
  },

  /** Cancel a pending request the current user sent. */
  async cancel(userId: string, requestId: string): Promise<void> {
    const request = await friendRepository.findRequestById(requestId);
    if (!request || request.status !== 'pending') {
      throw new NotFoundError('That request is no longer available.');
    }
    if (request.senderId !== userId) {
      throw new ForbiddenError('You cannot cancel this request.');
    }
    await friendRepository.setRequestStatus(requestId, 'cancelled');
  },

  async listFriends(userId: string): Promise<FriendSummary[]> {
    const friends = await friendRepository.listFriends(userId);
    const summaries = await userRepository.getPublicSummaries(friends.map((f) => f.otherUserId));
    return friends.flatMap((f) => {
      const s = summaries.get(f.otherUserId);
      return s
        ? [{ friendshipId: f.friendshipId, user: toSummary(s), since: f.since.toISOString() }]
        : [];
    });
  },

  async listIncoming(userId: string): Promise<IncomingFriendRequest[]> {
    const rows = await friendRepository.listIncoming(userId);
    const named = rows.filter((r) => r.origin !== 'session').map((r) => r.senderId);
    const summaries = await userRepository.getPublicSummaries(named);
    return rows.map((r) => {
      const s = r.origin !== 'session' ? summaries.get(r.senderId) : undefined;
      return {
        requestId: r.id,
        origin: r.origin,
        fromUser: s ? toSummary(s) : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  },

  async listOutgoing(userId: string): Promise<OutgoingFriendRequest[]> {
    const rows = await friendRepository.listOutgoing(userId);
    const named = rows.filter((r) => r.origin !== 'session').map((r) => r.receiverId);
    const summaries = await userRepository.getPublicSummaries(named);
    return rows.map((r) => {
      const s = r.origin !== 'session' ? summaries.get(r.receiverId) : undefined;
      return {
        requestId: r.id,
        origin: r.origin,
        toUser: s ? toSummary(s) : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  },

  /** Remove a friend (graceful, silent by default — FRIEND_SYSTEM.md §4). */
  async removeFriend(userId: string, friendshipId: string): Promise<void> {
    const friendship = await friendRepository.getFriendshipById(friendshipId);
    if (!friendship || friendship.deletedAt) {
      throw new NotFoundError('That friendship was not found.');
    }
    if (friendship.userLow !== userId && friendship.userHigh !== userId) {
      throw new ForbiddenError('You are not part of that friendship.');
    }
    await friendRepository.softDeleteFriendship(friendshipId);
    const otherId = friendship.userLow === userId ? friendship.userHigh : friendship.userLow;
    notifier.emitToUser(otherId, FRIEND_SERVER_EVENTS.FRIEND_REMOVED, { friendshipId });
  },

  /** Block a user: severs friendship + prevents all future contact bidirectionally. */
  async block(userId: string, blockedId: string, reason?: string): Promise<void> {
    if (userId === blockedId) throw new ValidationError('You cannot block yourself.');
    const target = await userRepository.findById(blockedId);
    if (!target) throw new NotFoundError('That user was not found.');

    const friendship = await friendRepository.findActiveFriendship(userId, blockedId);
    await friendRepository.block(userId, blockedId, reason);

    notifier.emitToUser(userId, FRIEND_SERVER_EVENTS.USER_BLOCKED, { blockedUserId: blockedId });
    if (friendship) {
      notifier.emitToUser(blockedId, FRIEND_SERVER_EVENTS.FRIEND_REMOVED, {
        friendshipId: friendship.id,
      });
    }
  },

  async unblock(userId: string, blockedId: string): Promise<void> {
    await friendRepository.unblock(userId, blockedId);
  },

  async listBlocked(userId: string): Promise<BlockedUserItem[]> {
    const rows = await friendRepository.listBlocked(userId);
    const summaries = await userRepository.getPublicSummaries(rows.map((r) => r.blockedId));
    return rows.flatMap((r) => {
      const s = summaries.get(r.blockedId);
      return s ? [{ user: toSummary(s), createdAt: r.createdAt.toISOString() }] : [];
    });
  },
};
