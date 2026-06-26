import { createServer } from 'node:http';
import { createApp } from './app.js';
import { createSocketServer } from './realtime/socketServer.js';
import { config } from './config/env.js';
import { logger } from './config/logger.js';
import { closeDatabase } from './db/client.js';

/**
 * API entrypoint. Express and Socket.IO share one HTTP server / process
 * (modular monolith — ARCHITECTURE.md §2.3, TDR-10).
 */
async function main(): Promise<void> {
  const app = createApp();
  const httpServer = createServer(app);
  const io = createSocketServer(httpServer);

  httpServer.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Campusly API listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    io.close();
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
