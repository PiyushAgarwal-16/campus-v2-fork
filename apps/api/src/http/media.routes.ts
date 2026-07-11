import { Router } from 'express';
import { z } from 'zod';
import { UploadUrlRequestSchema, type DownloadUrlResponse } from '@campusly/shared-types';
import { asyncHandler } from './asyncHandler.js';
import { sendData } from './respond.js';
import { requireAuth, getAuth } from '../middleware/requireAuth.js';
import { uploadRateLimiter } from '../middleware/rateLimiter.js';
import { mediaService } from '../services/mediaService.js';

/**
 * Media REST endpoints (API_SPEC.md §8, MEDIA_SYSTEM.md §3). Bytes never transit
 * the API — these endpoints issue signed URLs and manage references only.
 */
export const mediaRouter: Router = Router();

mediaRouter.use(requireAuth);

const IdParam = z.object({ id: z.string().uuid() });

/** POST /media/upload-url — validate and sign a direct upload URL. */
mediaRouter.post(
  '/media/upload-url',
  uploadRateLimiter,
  asyncHandler(async (req, res) => {
    const input = UploadUrlRequestSchema.parse(req.body);
    const result = await mediaService.requestUploadUrl(getAuth(req).sub, input);
    sendData(res, result, 201);
  }),
);

/** POST /media/:id/confirm — mark an uploaded asset active. */
mediaRouter.post(
  '/media/:id/confirm',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const media = await mediaService.confirmUpload(getAuth(req).sub, id);
    sendData(res, { media });
  }),
);

/** GET /media/:id/url — access-checked signed download URL. */
mediaRouter.get(
  '/media/:id/url',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    const result: DownloadUrlResponse = await mediaService.getDownloadUrl(getAuth(req), id);
    sendData(res, result);
  }),
);

/** DELETE /media/:id — delete own media (purges bytes). */
mediaRouter.delete(
  '/media/:id',
  asyncHandler(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await mediaService.deleteMedia(getAuth(req).sub, id);
    sendData(res, { success: true });
  }),
);
