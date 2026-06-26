import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { universities, type UniversityRow } from '../db/schema.js';

/**
 * Data access for universities (DATABASE_SCHEMA.md §5.1).
 * The only layer that touches the DB for this entity (CODING_STANDARDS.md §5).
 */
export const universityRepository = {
  /**
   * Finds an active university whose verified `email_domains` contains the
   * given domain. Used at sign-in to confirm institutional eligibility
   * (AUTH_SYSTEM.md §3).
   */
  async findByEmailDomain(domain: string): Promise<UniversityRow | null> {
    const normalized = domain.trim().toLowerCase();
    const rows = await db
      .select()
      .from(universities)
      .where(
        sql`${universities.isActive} = true and ${normalized} = any(${universities.emailDomains})`,
      )
      .limit(1);
    return rows[0] ?? null;
  },
};
