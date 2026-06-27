import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createSocketServer } from './realtime/socketServer.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase } from './db/client.js';
import { matchingService } from './services/matchingService.js';
import { mediaService } from './services/mediaService.js';
import { startTrendingJob, DEFAULT_WALL_CATEGORIES } from './services/wallService.js';
import { wallRepository } from './repositories/wallRepository.js';
import { adminService, DEFAULT_FEATURE_FLAGS } from './services/adminService.js';
import { adminRepository } from './repositories/adminRepository.js';

/**
 * API entrypoint. Express and Socket.IO share one HTTP server / process
 * (modular monolith — ARCHITECTURE.md §2.3, TDR-10).
 */
async function main(): Promise<void> {
  const app = createApp();
  const httpServer = createServer(app);
  createSocketServer(httpServer);

  // Recover matching state before accepting connections (MATCHING_ENGINE.md §5.9).
  await matchingService.recover();

  // Begin temporary-media expiry/cleanup sweeps (MEDIA_SYSTEM.md §5).
  mediaService.startCleanup();

  // Seed global wall categories (PUBLIC_WALL.md §4) and start trending job (§10.8).
  await wallRepository.ensureGlobalCategories(DEFAULT_WALL_CATEGORIES);
  startTrendingJob();

  // Seed feature flags (ADMIN_PANEL.md §10) and start the expired-ban sweeper (§5).
  await adminRepository.ensureFlags(DEFAULT_FEATURE_FLAGS);
  adminService.startBanSweeper();

  httpServer.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Campusly API listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    httpServer.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
