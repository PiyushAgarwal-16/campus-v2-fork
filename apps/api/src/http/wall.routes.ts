import { Router } from 'express';
import { z } from 'zod';
import {
  CreatePostSchema,
  UpdatePostSchema,
  CreateReplySchema,
  ReactSchema,
  VotePollSchema,
  ReportContentSchema,
  WallFeedQuerySchema,
  WallSearchQuerySchema,
} from '@campusly/shared-types';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { writeRateLimiter, reportRateLimiter } from '../middleware/rateLimiter.js';
import { wallService } from '../services/wallService.js';

/**
 * Campus Wall REST endpoints (API_SPEC.md §7, PUBLIC_WALL.md). Creation is REST;
 * realtime fan-out is Socket.IO (SOCKET_EVENTS.md §9). All require auth and are
 * campus-scoped server-side via the caller's universityId claim.
 */
export const wallRouter: Router = Router();

wallRouter.use(requireAuth);

const IdParam = z.object({ id: z.string().uuid() });

/** GET /wall/categories — list categories (global + campus). */
wallRouter.get(
  '/wall/categories',
  asyncHandler(async (req, res) => {
    const categories = await wallService.listCategories(getAuth(req).universityId);
    sendData(res, { categories });
  }),
);

/** GET /wall/trending — materialized trending posts. */
wallRouter.get(
  '/wall/trending',
  asyncHandler(async (req, res) => {
    const result = await wallService.feed(getAuth(req), { mode: 'trending', limit: 20 });
    sendData(res, result);
  }),
);

/** GET /wall/bookmarks — the caller's saved posts. */
wallRouter.get(
  '/wall/bookmarks',
  asyncHandler(async (req, res) => {
    const { cursor, limit } = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    const result = await wallService.listBookmarks(getAuth(req), cursor, limit);
    sendData(res, result);
  }),
);

/** GET /wall/posts/search — full-text search of campus posts. */
wallRouter.get(
  '/wall/posts/search',
  asyncHandler(async (req, res) => {
    const query = WallSearchQuerySchema.parse(req.query);
    const result = await wallService.search(getAuth(req), query);
    sendData(res, result);
  }),
);

/** POST /wall/posts — create a post (named or anonymous). */
wallRouter.post(
  '/wall/posts',
  writeRateLimiter,
  asyncHandler(async (req, res) => {
    const input = CreatePostSchema.parse(req.body);
    const post = await wallService.createPost(getAuth(req), input);
    sendData(res, { post }, 201);
  }),
);

/** GET /wall/posts — campus feed (latest/trending, filterable, cursor). */
wallRouter.get(
  '/wall/posts',
  asyncHandler(async (req, res) => {
    const query = WallFeedQuerySchema.parse(req.query);
    const result = await wallService.feed(getAuth(req), query);
    sendData(res, result);
  }),
);

/** GET /wall/posts/:id — a post with its replies. */
wallRouter.get(
  '/wall/posts/:id',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const result = await wallService.getPost(getAuth(req), id);
    sendData(res, result);
  }),
);

/** PATCH /wall/posts/:id — edit own post. */
wallRouter.patch(
  '/wall/posts/:id',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const { body } = UpdatePostSchema.parse(req.body);
    const post = await wallService.updatePost(getAuth(req), id, body);
    sendData(res, { post });
  }),
);

/** DELETE /wall/posts/:id — soft-delete own post. */
wallRouter.delete(
  '/wall/posts/:id',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await wallService.deletePost(getAuth(req), id);
    sendData(res, { success: true });
  }),
);

/** POST /wall/posts/:id/replies — reply to a post. */
wallRouter.post(
  '/wall/posts/:id/replies',
  writeRateLimiter,
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const input = CreateReplySchema.parse(req.body);
    const reply = await wallService.createReply(getAuth(req), id, input);
    sendData(res, { reply }, 201);
  }),
);

/** DELETE /wall/replies/:id — delete own reply. */
wallRouter.delete(
  '/wall/replies/:id',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await wallService.deleteReply(getAuth(req), id);
    sendData(res, { success: true });
  }),
);

/** POST /wall/posts/:id/react — add/change a reaction (post or reply). */
wallRouter.post(
  '/wall/posts/:id/react',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const { targetType, type } = ReactSchema.parse(req.body);
    const result = await wallService.react(getAuth(req), targetType, id, type);
    sendData(res, result);
  }),
);

/** DELETE /wall/posts/:id/react — remove a reaction (post or reply). */
wallRouter.delete(
  '/wall/posts/:id/react',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const { targetType } = z
      .object({ targetType: z.enum(['wall_post', 'wall_reply']).default('wall_post') })
      .parse(req.query);
    const result = await wallService.unreact(getAuth(req), targetType, id);
    sendData(res, result);
  }),
);

/** POST /wall/posts/:id/bookmark — save a post. */
wallRouter.post(
  '/wall/posts/:id/bookmark',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await wallService.bookmark(getAuth(req), id);
    sendData(res, { success: true });
  }),
);

/** DELETE /wall/posts/:id/bookmark — remove a bookmark. */
wallRouter.delete(
  '/wall/posts/:id/bookmark',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await wallService.unbookmark(getAuth(req), id);
    sendData(res, { success: true });
  }),
);

/** POST /wall/posts/:id/vote — cast/change a poll vote. */
wallRouter.post(
  '/wall/posts/:id/vote',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const { optionId } = VotePollSchema.parse(req.body);
    const post = await wallService.votePoll(getAuth(req), id, optionId);
    sendData(res, { post });
  }),
);

/** POST /wall/posts/:id/report — report a post or reply. */
wallRouter.post(
  '/wall/posts/:id/report',
  reportRateLimiter,
  asyncHandler(async (req, res) => {
    const input = ReportContentSchema.parse(req.body);
    await wallService.report(
      getAuth(req),
      input.targetType,
      input.targetId,
      input.reason,
      input.details,
    );
    sendData(res, { success: true });
  }),
);

/** GET /wall/users/:userId/posts — list posts by a specific user. */
wallRouter.get(
  '/wall/users/:userId/posts',
  asyncHandler(async (req, res) => {
    const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
    const { cursor, limit } = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    const result = await wallService.listUserPosts(getAuth(req), userId, cursor, limit);
    sendData(res, result);
  }),
);
