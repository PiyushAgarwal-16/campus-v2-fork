import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { globalRateLimiter } from './middleware/rateLimiter.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRouter } from './http/health.routes.js';
import { authRouter } from './http/auth.routes.js';
import { userRouter } from './http/user.routes.js';
import { matchingRouter } from './http/matching.routes.js';
import { messagingRouter } from './http/messaging.routes.js';
import { friendRouter } from './http/friend.routes.js';
import { mediaRouter } from './http/media.routes.js';
import { localMediaRouter } from './http/localMedia.routes.js';
import { wallRouter } from './http/wall.routes.js';
import { communityRouter } from './http/community.routes.js';
import { notificationRouter } from './http/notification.routes.js';
import { announcementRouter } from './http/announcement.routes.js';
import { adminRouter, appealRouter } from './http/admin.routes.js';
import { adminInspectorRouter } from './http/adminInspector.routes.js';

/** API version prefix (API_SPEC.md §2.1). */
export const API_PREFIX = '/api/v1';

/**
 * Builds the Express application: security headers, CORS, structured request
 * logging, rate limiting, the v1 router, and the central error handler.
 * Defense-in-depth lives at the Nginx edge too (SECURITY.md §16); these are
 * the application-layer protections.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // behind Nginx (ARCHITECTURE.md §14)

  app.use(helmet());

  const allowedOrigins = config.CORS_ORIGINS;
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
    }),
  );

  // Local object-storage stand-in handles raw binary uploads/downloads and MUST
  // be mounted before the JSON body parser (dev only — MEDIA_DRIVER=local).
  app.use(localMediaRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));
  app.use(globalRateLimiter);

  app.use(API_PREFIX, healthRouter);
  app.use(API_PREFIX, authRouter);
  app.use(API_PREFIX, userRouter);
  app.use(API_PREFIX, matchingRouter);
  app.use(API_PREFIX, messagingRouter);
  app.use(API_PREFIX, friendRouter);
  app.use(API_PREFIX, mediaRouter);
  app.use(API_PREFIX, wallRouter);
  app.use(API_PREFIX, communityRouter);
  app.use(API_PREFIX, notificationRouter);
  app.use(API_PREFIX, announcementRouter);
  app.use(API_PREFIX, adminRouter);
  app.use(API_PREFIX, adminInspectorRouter);
  app.use(API_PREFIX, appealRouter);

  // Feature routers (wall, communities, ...) mount under API_PREFIX in later phases.

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
