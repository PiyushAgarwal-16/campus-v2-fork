import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { notificationService } from '../services/notificationService.js';

/**
 * In-app notification REST endpoints (NOTIFICATION_SYSTEM.md, API_SPEC.md).
 * All require auth; the recipient is always the authenticated caller. Live
 * delivery is over Socket.IO (`notification_new`); these endpoints back the
 * notifications screen and unread badge.
 */
export const notificationRouter: Router = Router();

notificationRouter.use(requireAuth);

const IdParam = z.object({ id: z.string().uuid() });

/** GET /notifications — the caller's notifications (newest first, cursor). */
notificationRouter.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const { cursor, limit } = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .parse(req.query);
    const result = await notificationService.list(getAuth(req).sub, cursor, limit);
    sendData(res, result);
  }),
);

/** GET /notifications/unread-count — unread badge count. */
notificationRouter.get(
  '/notifications/unread-count',
  asyncHandler(async (req, res) => {
    const count = await notificationService.unreadCount(getAuth(req).sub);
    sendData(res, { count });
  }),
);

/** POST /notifications/:id/read — mark one notification read. */
notificationRouter.post(
  '/notifications/:id/read',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await notificationService.markRead(getAuth(req).sub, id);
    sendData(res, { success: true });
  }),
);

/** POST /notifications/read-all — mark all the caller's notifications read. */
notificationRouter.post(
  '/notifications/read-all',
  asyncHandler(async (req, res) => {
    await notificationService.markAllRead(getAuth(req).sub);
    sendData(res, { success: true });
  }),
);
