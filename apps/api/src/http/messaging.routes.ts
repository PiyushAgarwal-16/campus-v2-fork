import { Router } from 'express';
import { MessageHistoryQuerySchema } from '@campusly/shared-types';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { messagingService } from '../services/messagingService.js';

/**
 * Messaging REST (API_SPEC.md §2.4 pagination). Live delivery is Socket.IO
 * (SOCKET_EVENTS.md §5); this endpoint serves durable conversation history.
 */
export const messagingRouter: Router = Router();

messagingRouter.use(requireAuth);

/** GET /messages?contextType=&contextId=&cursor=&limit= — paginated history. */
messagingRouter.get(
  '/messages',
  asyncHandler(async (req, res) => {
    const query = MessageHistoryQuerySchema.parse(req.query);
    const result = await messagingService.history(getAuth(req).sub, query);
    sendData(res, result, 200);
  }),
);
