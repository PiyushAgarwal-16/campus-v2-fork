import pino from 'pino';
import { config, isProduction } from '../config/env.js';

/**
 * Structured JSON logger (CODING_STANDARDS.md §13.4).
 * Pretty-prints in development; raw JSON in production for log aggregation.
 * Never log secrets, tokens, or message content — reference by key name only.
 */
export const logger = pino({
  level: config.LOG_LEVEL,
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
      },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
    remove: true,
  },
});
