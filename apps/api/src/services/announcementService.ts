import type { AccessTokenClaims, Announcement } from '@campusly/shared-types';
import type { AnnouncementRow } from '../db/schema.js';
import { adminRepository } from '../repositories/adminRepository.js';

/**
 * Student-facing announcement reads (ADMIN_PANEL.md §9). Admins create/broadcast
 * announcements via the admin surface; students fetch the currently-active ones
 * for their campus (global + campus-scoped) to render the Wall banner, and
 * receive new ones live over the `announcement_broadcast` socket event.
 */

function toAnnouncement(a: AnnouncementRow): Announcement {
  return {
    id: a.id,
    universityId: a.universityId,
    title: a.title,
    body: a.body,
    audience: a.audience,
    startsAt: a.startsAt ? a.startsAt.toISOString() : null,
    endsAt: a.endsAt ? a.endsAt.toISOString() : null,
    createdAt: a.createdAt.toISOString(),
  };
}

export const announcementService = {
  /** Active announcements visible to the authenticated user's campus. */
  async listActiveForUser(claims: AccessTokenClaims): Promise<Announcement[]> {
    const rows = await adminRepository.listActiveAnnouncements({
      universityId: claims.universityId,
      now: new Date(),
    });
    return rows.map(toAnnouncement);
  },
};
