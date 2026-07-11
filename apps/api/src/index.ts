import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createSocketServer } from './realtime/socketServer.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase } from './db/client.js';
import { matchingService } from './services/matchingService.js';
import { mediaService } from './services/mediaService.js';
import {
  startTrendingJob,
  stopTrendingJob,
  DEFAULT_WALL_CATEGORIES,
} from './services/wallService.js';
import { wallRepository } from './repositories/wallRepository.js';
import { adminService, DEFAULT_FEATURE_FLAGS } from './services/adminService.js';
import { subscriptionService } from './services/subscriptionService.js';
import { adminRepository } from './repositories/adminRepository.js';

/**
 * API entrypoint. Express and Socket.IO share one HTTP server / process
 * (modular monolith — ARCHITECTURE.md §2.3, TDR-10).
 */

/** Hard cap on graceful shutdown before forcing exit (single-VM restarts/deploys). */
const SHUTDOWN_TIMEOUT_MS = 25_000;

async function main(): Promise<void> {
  const app = createApp();
  const httpServer = createServer(app);
  const io = createSocketServer(httpServer);

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
  // Auto-expire lapsed subscriptions and downgrade the cache (ADMIN_PANEL.md §8).
  subscriptionService.startExpirySweep();

  httpServer.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'AnonymousU API listening');
  });

  // Graceful shutdown: stop accepting work, drain connections, stop background
  // timers, then close the database last (PostgreSQL audit R-1). A guard makes
  // repeated signals a no-op; a watchdog forces exit if the drain ever hangs.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown started');

    const watchdog = setTimeout(() => {
      logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Graceful shutdown timed out; forcing exit');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    watchdog.unref();

    try {
      // 1. Stop accepting new connections and gracefully drain. Socket.IO is
      //    attached to this same HTTP server, so io.close() disconnects clients
      //    cleanly AND closes the underlying HTTP server, resolving once all
      //    in-flight requests have finished (idle keep-alives are nudged shut).
      await new Promise<void>((resolve, reject) => {
        io.close((err) => (err ? reject(err) : resolve()));
        httpServer.closeIdleConnections?.();
      });

      // 2. Stop background timers before the database closes, so no sweep starts
      //    against a closing pool.
      mediaService.stopCleanup();
      adminService.stopBanSweeper();
      subscriptionService.stopExpirySweep();
      matchingService.stopSweeper();
      stopTrendingJob();

      // 3. Close the database last.
      await closeDatabase();

      clearTimeout(watchdog);
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      clearTimeout(watchdog);
      logger.error({ err }, 'Graceful shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
