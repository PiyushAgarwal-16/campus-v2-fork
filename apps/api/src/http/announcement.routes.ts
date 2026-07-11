import { Router } from 'express';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { announcementService } from '../services/announcementService.js';

/**
 * Student-facing announcements (ADMIN_PANEL.md §9). Returns the announcements
 * currently active for the caller's campus so the client can render the Wall
 * banner; live updates arrive over the `announcement_broadcast` socket event.
 */
export const announcementRouter: Router = Router();

announcementRouter.use(requireAuth);

/** GET /announcements — active announcements for the caller's campus. */
announcementRouter.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const announcements = await announcementService.listActiveForUser(getAuth(req));
    sendData(res, { announcements });
  }),
);
