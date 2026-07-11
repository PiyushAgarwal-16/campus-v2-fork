import type { AccessTokenClaims, AdminReport, ReportContext } from '@campusly/shared-types';
import { MODERATOR_ROLES } from '@campusly/shared-types';
import { NotFoundError } from '../domain/errors.js';
import type { ReportRow, WallPostRow, WallReplyRow, CommunityPostRow } from '../db/schema.js';
import { moderationRepository } from '../repositories/moderationRepository.js';
import { wallRepository } from '../repositories/wallRepository.js';
import { communityRepository } from '../repositories/communityRepository.js';
import { messagingRepository } from '../repositories/messagingRepository.js';
import { userRepository } from '../repositories/userRepository.js';
import { dataInspectorRepository } from '../repositories/dataInspectorRepository.js';

/**
 * Report_Context resolver (ADMIN_PANEL.md §5; Requirement 7). Resolves a filed
 * report into a displayable `ReportContext` DTO whose `target` shape depends on
 * the report's `target_type`:
 *
 *  - `message`        → a bounded transcript window around the reported message
 *  - `wall_post`      → full text + media references
 *  - `wall_reply`     → full text
 *  - `community_post` → full text + media references
 *  - `user`           → the reported user's public summary + recent activity
 *
 * Fetching is delegated to the existing repositories (report lookup reuses
 * `moderationRepository.getReport`; posts/replies/media reuse `wallRepository`
 * and `communityRepository`; message→conversation resolution reuses
 * `messagingRepository`; the transcript window reuses
 * `dataInspectorRepository.readConversationWindow`); no queries are duplicated.
 *
 * SCOPE (Task 5.2 extends 5.1):
 *
 *  - Graceful unavailability (Req 7.6): when the reported *content* has been
 *    removed or purged (its lookup misses), the resolver returns a defined
 *    `contentUnavailable: true` target (with `content: null`, and an empty
 *    transcript for message targets) instead of throwing. The report row
 *    itself is still required — a missing report still throws `NotFoundError`.
 *  - Gated, audited identity reveal (Req 7.5): the verified author of anonymous
 *    reported content is resolved ONLY when the caller both explicitly requests
 *    it and holds a Moderator_Role. Each successful reveal writes exactly one
 *    `context.identity_reveal` audit entry (actor + target) via the existing
 *    `moderationRepository.writeAudit`. Absent an authorized request, anonymity
 *    is preserved (`authorId` stays null).
 */

type ReportTarget = ReportContext['target'];

/**
 * Mutable accumulator threaded through resolution so that:
 *  - resolvers can consult whether an authorized reveal was requested, and
 *  - a single `context.identity_reveal` audit entry is written per report when
 *    an anonymous author is actually unmasked.
 */
interface RevealContext {
  /** True only when a reveal was requested AND the actor holds a Moderator_Role. */
  readonly canReveal: boolean;
  /** Set true when an anonymous author was actually unmasked during resolution. */
  revealed: boolean;
}

class ReportContextService {
  /**
   * Resolve a report into its surrounding context. Throws {@link NotFoundError}
   * when the report itself does not exist. When `options.revealIdentity` is set
   * and the actor holds a Moderator_Role, the verified author of anonymous
   * reported content is unmasked and the access is audited; otherwise anonymity
   * is preserved (the default).
   */
  async getContext(
    claims: AccessTokenClaims,
    reportId: string,
    options: { revealIdentity?: boolean } = {},
  ): Promise<ReportContext> {
    const report = await moderationRepository.getReport(reportId);
    if (!report) throw new NotFoundError('Report not found.');

    const reveal: RevealContext = {
      canReveal: options.revealIdentity === true && MODERATOR_ROLES.includes(claims.role),
      revealed: false,
    };
    const target = await this.resolveTarget(report, reveal);

    // Exactly one audit entry per successful anonymity→identity resolution
    // (Req 7.5). Written only when an anonymous author was actually unmasked.
    if (reveal.revealed) {
      await moderationRepository.writeAudit({
        actorId: claims.sub,
        action: 'context.identity_reveal',
        targetType: report.targetType,
        targetId: report.targetId,
      });
    }

    return { report: toAdminReport(report), target };
  }

  private async resolveTarget(report: ReportRow, reveal: RevealContext): Promise<ReportTarget> {
    switch (report.targetType) {
      case 'message':
        return this.resolveMessage(report.targetId);
      case 'wall_post':
        return this.resolveWallPost(report.targetId, reveal);
      case 'wall_reply':
        return this.resolveWallReply(report.targetId, reveal);
      case 'community_post':
        return this.resolveCommunityPost(report.targetId, reveal);
      case 'user':
        return this.resolveUser(report.targetId);
      default:
        // Targets outside the reviewable set (e.g. marketplace_item,
        // lost_found_item) have no displayable context resolver yet. This is a
        // genuinely unsupported type, not removed/purged content, so it still
        // fails rather than degrading to a `contentUnavailable` marker.
        throw new NotFoundError('Report target type is not supported for context resolution.');
    }
  }

  /**
   * A bounded transcript window drawn from the same conversation as the reported
   * message. The message's conversation is resolved first, then a window centred
   * on the reported message is read; the reported message is surfaced as
   * `content` and flagged within the transcript.
   */
  private async resolveMessage(messageId: string): Promise<ReportTarget> {
    const context = await messagingRepository.findContextByMessageId(messageId);
    // Graceful unavailability (Req 7.6): a removed/purged message degrades to a
    // `contentUnavailable` target with an empty transcript rather than failing.
    if (!context) {
      return { kind: 'message', content: null, transcript: [], contentUnavailable: true };
    }

    const transcript = await dataInspectorRepository.readConversationWindow({
      contextType: context.contextType,
      conversationId: context.contextId,
      aroundMessageId: messageId,
    });
    const reported = transcript.find((message) => message.isReported === true) ?? null;
    return { kind: 'message', content: reported, transcript };
  }

  private async resolveWallPost(postId: string, reveal: RevealContext): Promise<ReportTarget> {
    const post = await wallRepository.getPostById(postId);
    // Graceful unavailability (Req 7.6): removed/purged post → contentUnavailable.
    if (!post) return { kind: 'wall_post', content: null, contentUnavailable: true };

    const mediaByPost = await wallRepository.mediaForPosts([post.id]);
    const mediaIds = mediaByPost.get(post.id) ?? [];
    return { kind: 'wall_post', content: wallPostContent(post, mediaIds, reveal) };
  }

  private async resolveWallReply(replyId: string, reveal: RevealContext): Promise<ReportTarget> {
    const reply = await wallRepository.getReplyById(replyId);
    // Graceful unavailability (Req 7.6): removed/purged reply → contentUnavailable.
    if (!reply) return { kind: 'wall_reply', content: null, contentUnavailable: true };

    return { kind: 'wall_reply', content: wallReplyContent(reply, reveal) };
  }

  private async resolveCommunityPost(postId: string, reveal: RevealContext): Promise<ReportTarget> {
    const post = await communityRepository.getPostById(postId);
    // Graceful unavailability (Req 7.6): removed/purged community post → contentUnavailable.
    if (!post) return { kind: 'community_post', content: null, contentUnavailable: true };

    return { kind: 'community_post', content: communityPostContent(post, reveal) };
  }

  private async resolveUser(userId: string): Promise<ReportTarget> {
    const summaries = await userRepository.getPublicSummaries([userId]);
    const summary = summaries.get(userId);
    // Graceful unavailability (Req 7.6): purged account → contentUnavailable.
    if (!summary) return { kind: 'user', content: null, contentUnavailable: true };

    // Recent reportable activity relevant to the report: the user's most recent
    // visible wall posts (reuses the existing author feed query).
    const recentPosts = await wallRepository.listPostsByAuthor(userId);
    const recentActivity = recentPosts.map((post) => ({
      kind: 'wall_post' as const,
      id: post.id,
      body: post.body,
      status: post.status,
      createdAt: post.createdAt.toISOString(),
    }));
    return { kind: 'user', content: { user: summary, recentActivity } };
  }
}

export const reportContextService = new ReportContextService();

// --- mappers ----------------------------------------------------------------

function toAdminReport(r: ReportRow): AdminReport {
  return {
    id: r.id,
    reporterId: r.reporterId,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Resolves the `authorId` a caller may see for a piece of content. Non-anonymous
 * authorship is always public. Anonymous authorship stays hidden (null) unless
 * an authorized reveal was requested — in which case the verified author is
 * surfaced and the reveal is recorded on `reveal` so the caller audits it once.
 */
function resolveAuthorId(
  authorId: string,
  isAnonymous: boolean,
  reveal: RevealContext,
): string | null {
  if (!isAnonymous) return authorId;
  if (reveal.canReveal) {
    reveal.revealed = true;
    return authorId;
  }
  return null;
}

function wallPostContent(post: WallPostRow, mediaIds: string[], reveal: RevealContext) {
  return {
    id: post.id,
    authorId: resolveAuthorId(post.authorId, post.isAnonymous, reveal),
    isAnonymous: post.isAnonymous,
    body: post.body,
    status: post.status,
    mediaIds,
    createdAt: post.createdAt.toISOString(),
  };
}

function wallReplyContent(reply: WallReplyRow, reveal: RevealContext) {
  return {
    id: reply.id,
    postId: reply.postId,
    authorId: resolveAuthorId(reply.authorId, reply.isAnonymous, reveal),
    isAnonymous: reply.isAnonymous,
    body: reply.body,
    status: reply.status,
    createdAt: reply.createdAt.toISOString(),
  };
}

function communityPostContent(post: CommunityPostRow, reveal: RevealContext) {
  return {
    id: post.id,
    communityId: post.communityId,
    authorId: resolveAuthorId(post.authorId, post.isAnonymous, reveal),
    isAnonymous: post.isAnonymous,
    body: post.body,
    status: post.status,
    // Community posts carry no media attachments in the current schema.
    mediaIds: [] as string[],
    createdAt: post.createdAt.toISOString(),
  };
}
