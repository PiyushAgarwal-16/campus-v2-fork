import { db } from '../db/client.js';
import { loginHistory } from '../db/schema.js';

type LoginEvent = 'login_success' | 'login_failure' | 'refresh' | 'logout';

/**
 * Append-only login/security audit (DATABASE_SCHEMA.md §5.6, SECURITY.md §9).
 */
export const loginHistoryRepository = {
  async record(input: {
    userId?: string | null;
    event: LoginEvent;
    ipHash?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    await db.insert(loginHistory).values({
      userId: input.userId ?? null,
      event: input.event,
      ipHash: input.ipHash ?? null,
      userAgent: input.userAgent ?? null,
    });
  },
};
