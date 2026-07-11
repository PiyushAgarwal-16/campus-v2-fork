import { sql, eq } from 'drizzle-orm';
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

  /** All active universities (for admin pickers), ordered by name. */
  async listActive(): Promise<UniversityRow[]> {
    return db
      .select()
      .from(universities)
      .where(eq(universities.isActive, true))
      .orderBy(universities.name);
  },

  /**
   * DEV-ONLY fallback university for open sign-in (AUTH_ALLOW_ANY_DOMAIN).
   * Upserts a single "Open Campus (Dev)" row so users from unrecognized domains
   * have a valid campus to attach to. Not used when verified-only mode is on.
   */
  async getOrCreateOpenCampus(): Promise<UniversityRow> {
    const existing = await db
      .select()
      .from(universities)
      .where(eq(universities.name, OPEN_CAMPUS_NAME))
      .limit(1);
    if (existing[0]) return existing[0];
    const [created] = await db
      .insert(universities)
      .values({ name: OPEN_CAMPUS_NAME, shortName: 'DEV', emailDomains: [] })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    // Race: another request created it — read it back.
    const reread = await db
      .select()
      .from(universities)
      .where(eq(universities.name, OPEN_CAMPUS_NAME))
      .limit(1);
    if (!reread[0]) throw new Error('Failed to provision Open Campus');
    return reread[0];
  },
};

const OPEN_CAMPUS_NAME = 'Open Campus (Dev)';
