import { Router } from 'express';
import { sendData } from './respond.js';
import { checkDatabase } from '../db/client.js';

/**
 * Health check (Phase 00 acceptance criteria; API_SPEC.md §2.3 envelope).
 * Reports process liveness and database connectivity.
 */
export const healthRouter: Router = Router();

healthRouter.get('/health', async (_req, res) => {
  const database = await checkDatabase();
  sendData(res, {
    status: 'ok' as const,
    service: 'campusly-api',
    database: database ? 'connected' : 'unavailable',
    timestamp: new Date().toISOString(),
  });
});
