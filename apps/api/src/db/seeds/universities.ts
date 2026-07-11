/**
 * Recognized-campus reference data (DATABASE_SCHEMA.md §5.1).
 *
 * These rows populate the `universities` table, which is the root of campus
 * scoping and the sign-in eligibility gate: at Google sign-in the backend
 * extracts the institutional email domain and requires a matching row here
 * (see `authService.loginWithGoogle` → `universityRepository.findByEmailDomain`).
 * A campus missing from this list cannot sign in.
 *
 * `emailDomains` are matched against the bare, lowercased host of the user's
 * email (e.g. `poornima.edu.in`, NOT `@poornima.edu.in`). The seed runner
 * normalizes each entry (lowercase + strip a leading `@`) before insert, so
 * either form is safe to write here.
 *
 * Add new campuses by appending an entry; the seed is idempotent (upsert by
 * unique name), so re-running only inserts new rows and refreshes existing ones.
 */
export interface UniversitySeed {
  name: string;
  shortName?: string;
  emailDomains: string[];
  city?: string;
  state?: string;
}

export const UNIVERSITY_SEED: UniversitySeed[] = [
  {
    name: 'Poornima University',
    shortName: 'Poornima',
    emailDomains: ['poornima.edu.in'],
    city: 'Jaipur',
    state: 'Rajasthan',
  },
  {
    name: 'JECRC University',
    shortName: 'JECRC',
    emailDomains: ['jecrc.edu.in'],
    city: 'Jaipur',
    state: 'Rajasthan',
  },
];
