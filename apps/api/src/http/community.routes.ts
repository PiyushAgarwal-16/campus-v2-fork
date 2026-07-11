import { Router } from 'express';
import { z } from 'zod';
import {
  CreateCommunitySchema,
  CreateCommunityPostSchema,
  CommunityReactSchema,
  InviteSchema,
  RoleChangeSchema,
  CommunityBrowseQuerySchema,
  CommunityFeedQuerySchema,
  ReportContentSchema,
} from '@campusly/shared-types';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { writeRateLimiter, reportRateLimiter } from '../middleware/rateLimiter.js';
import { communityService } from '../services/communityService.js';

/**
 * Communities & Clubs REST (API_SPEC.md §9). Role-based authorization is
 * enforced in the service. Community posts reuse wall content patterns.
 */
export const communityRouter: Router = Router();

communityRouter.use(requireAuth);

const IdParam = z.object({ id: z.string().uuid() });
const PostIdParam = z.object({ postId: z.string().uuid() });

/** GET /communities — browse/search. */
communityRouter.get(
  '/communities',
  asyncHandler(async (req, res) => {
    const query = CommunityBrowseQuerySchema.parse(req.query);
    const result = await communityService.browse(getAuth(req), query);
    sendData(res, result);
  }),
);

/** POST /communities — create a community/club. */
communityRouter.post(
  '/communities',
  writeRateLimiter,
  asyncHandler(async (req, res) => {
    const input = CreateCommunitySchema.parse(req.body);
    const community = await communityService.create(getAuth(req), input);
    sendData(res, { community }, 201);
  }),
);

/** GET /communities/invites — incoming invitations. */
communityRouter.get(
  '/communities/invites',
  asyncHandler(async (req, res) => {
    const invites = await communityService.listInvites(getAuth(req));
    sendData(res, { invites });
  }),
);

/** POST /communities/invites/:id/accept | /decline. */
communityRouter.post(
  '/communities/invites/:id/accept',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await communityService.respondInvite(getAuth(req), id, true);
    sendData(res, { success: true });
  }),
);
communityRouter.post(
  '/communities/invites/:id/decline',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await communityService.respondInvite(getAuth(req), id, false);
    sendData(res, { success: true });
  }),
);

/** Community-post actions (delete / react / report). */
communityRouter.delete(
  '/communities/posts/:postId',
  asyncHandler(async (req, res) => {
    const { postId } = PostIdParam.parse(req.params);
    await communityService.deletePost(getAuth(req), postId);
    sendData(res, { success: true });
  }),
);
communityRouter.post(
  '/communities/posts/:postId/react',
  asyncHandler(async (req, res) => {
    const { postId } = PostIdParam.parse(req.params);
    const { type } = CommunityReactSchema.parse(req.body);
    const result = await communityService.react(getAuth(req), postId, type);
    sendData(res, result);
  }),
);
communityRouter.delete(
  '/communities/posts/:postId/react',
  asyncHandler(async (req, res) => {
    const { postId } = PostIdParam.parse(req.params);
    const result = await communityService.unreact(getAuth(req), postId);
    sendData(res, result);
  }),
);
communityRouter.post(
  '/communities/posts/:postId/report',
  reportRateLimiter,
  asyncHandler(async (req, res) => {
    const { postId } = PostIdParam.parse(req.params);
    const { reason, details } = ReportContentSchema.pick({ reason: true, details: true }).parse(
      req.body,
    );
    await communityService.report(getAuth(req), postId, reason, details);
    sendData(res, { success: true });
  }),
);

/** GET /communities/:id — detail. */
communityRouter.get(
  '/communities/:id',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const community = await communityService.detail(getAuth(req), id);
    sendData(res, { community });
  }),
);

/** POST /communities/:id/join | /leave. */
communityRouter.post(
  '/communities/:id/join',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const membership = await communityService.join(getAuth(req), id);
    sendData(res, { membership });
  }),
);
communityRouter.post(
  '/communities/:id/leave',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await communityService.leave(getAuth(req), id);
    sendData(res, { success: true });
  }),
);

/** GET /communities/:id/feed and POST a community post. */
communityRouter.get(
  '/communities/:id/feed',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const query = CommunityFeedQuerySchema.parse(req.query);
    const result = await communityService.feed(getAuth(req), id, query);
    sendData(res, result);
  }),
);
communityRouter.post(
  '/communities/:id/posts',
  writeRateLimiter,
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const input = CreateCommunityPostSchema.parse(req.body);
    const post = await communityService.createPost(getAuth(req), id, input);
    sendData(res, { post }, 201);
  }),
);

/** GET /communities/:id/members and member management. */
communityRouter.get(
  '/communities/:id/members',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const members = await communityService.members(getAuth(req), id);
    sendData(res, { members });
  }),
);
communityRouter.post(
  '/communities/:id/invites',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const { inviteeId } = InviteSchema.parse(req.body);
    const invite = await communityService.invite(getAuth(req), id, inviteeId);
    sendData(res, { invite }, 201);
  }),
);

const MemberParams = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
communityRouter.post(
  '/communities/:id/members/:userId/approve',
  asyncHandler(async (req, res) => {
    const { id, userId } = MemberParams.parse(req.params);
    await communityService.approveMember(getAuth(req), id, userId);
    sendData(res, { success: true });
  }),
);
communityRouter.post(
  '/communities/:id/members/:userId/role',
  asyncHandler(async (req, res) => {
    const { id, userId } = MemberParams.parse(req.params);
    const { role } = RoleChangeSchema.parse(req.body);
    await communityService.changeRole(getAuth(req), id, userId, role);
    sendData(res, { success: true });
  }),
);
communityRouter.delete(
  '/communities/:id/members/:userId',
  asyncHandler(async (req, res) => {
    const { id, userId } = MemberParams.parse(req.params);
    await communityService.removeMember(getAuth(req), id, userId);
    sendData(res, { success: true });
  }),
);
