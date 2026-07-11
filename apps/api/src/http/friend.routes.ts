import { Router } from 'express';
import { z } from 'zod';
import { SendFriendRequestSchema, BlockUserSchema } from '@campusly/shared-types';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { friendRequestRateLimiter } from '../middleware/rateLimiter.js';
import { friendService } from '../services/friendService.js';

/**
 * Friend system REST endpoints (API_SPEC.md §6, FRIEND_SYSTEM.md). All require
 * authentication. State changes happen here; real-time notifications are pushed
 * over Socket.IO (SOCKET_EVENTS.md §8).
 */
export const friendRouter: Router = Router();

friendRouter.use(requireAuth);

const IdParam = z.object({ id: z.string().uuid() });
const UserIdParam = z.object({ userId: z.string().uuid() });

/** POST /friends/requests — send a friend request. */
friendRouter.post(
  '/friends/requests',
  friendRequestRateLimiter,
  asyncHandler(async (req, res) => {
    const input = SendFriendRequestSchema.parse(req.body);
    const result = await friendService.sendRequest(getAuth(req).sub, input);
    sendData(res, result, 201);
  }),
);

/** GET /friends/requests/incoming — pending incoming requests. */
friendRouter.get(
  '/friends/requests/incoming',
  asyncHandler(async (req, res) => {
    const requests = await friendService.listIncoming(getAuth(req).sub);
    sendData(res, { requests });
  }),
);

/** GET /friends/requests/outgoing — pending outgoing requests. */
friendRouter.get(
  '/friends/requests/outgoing',
  asyncHandler(async (req, res) => {
    const requests = await friendService.listOutgoing(getAuth(req).sub);
    sendData(res, { requests });
  }),
);

/** POST /friends/requests/:id/accept — accept a request. */
friendRouter.post(
  '/friends/requests/:id/accept',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const result = await friendService.accept(getAuth(req).sub, id);
    sendData(res, result);
  }),
);

/** POST /friends/requests/:id/reject — reject a request. */
friendRouter.post(
  '/friends/requests/:id/reject',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await friendService.reject(getAuth(req).sub, id);
    sendData(res, { success: true });
  }),
);

/** DELETE /friends/requests/:id — cancel an outgoing request. */
friendRouter.delete(
  '/friends/requests/:id',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await friendService.cancel(getAuth(req).sub, id);
    sendData(res, { success: true });
  }),
);

/** GET /friends — the user's friends. */
friendRouter.get(
  '/friends',
  asyncHandler(async (req, res) => {
    const friends = await friendService.listFriends(getAuth(req).sub);
    sendData(res, { friends });
  }),
);

/** DELETE /friends/:id — remove a friend (friendship id). */
friendRouter.delete(
  '/friends/:id',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await friendService.removeFriend(getAuth(req).sub, id);
    sendData(res, { success: true });
  }),
);

/** POST /friends/block — block a user. */
friendRouter.post(
  '/friends/block',
  asyncHandler(async (req, res) => {
    const { userId, reason } = BlockUserSchema.parse(req.body);
    await friendService.block(getAuth(req).sub, userId, reason);
    sendData(res, { success: true });
  }),
);

/** DELETE /friends/block/:userId — unblock a user. */
friendRouter.delete(
  '/friends/block/:userId',
  asyncHandler(async (req, res) => {
    const { userId } = UserIdParam.parse(req.params);
    await friendService.unblock(getAuth(req).sub, userId);
    sendData(res, { success: true });
  }),
);

/** GET /friends/blocked — the user's blocked list. */
friendRouter.get(
  '/friends/blocked',
  asyncHandler(async (req, res) => {
    const blocked = await friendService.listBlocked(getAuth(req).sub);
    sendData(res, { blocked });
  }),
);
