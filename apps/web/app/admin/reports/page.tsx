'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, MessageSquare, FileText, User as UserIcon, Ban } from 'lucide-react';
import type {
  AdminReport,
  ApplyActionInput,
  ModerationActionType,
  ReportContext,
  ReportStatus,
  TranscriptMessage,
} from '@campusly/shared-types';
import { REPORT_STATUSES } from '@campusly/shared-types';
import { adminApi } from '../../../lib/admin';
import { Card, CardTitle } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Badge, type BadgeProps } from '../../../components/ui/Badge';
import { Select } from '../../../components/ui/Select';
import { Dialog } from '../../../components/ui/Dialog';
import { cn } from '../../../lib/utils';

/** The target type accepted by moderation actions (mirrors ApplyActionInput). */
type ApplyTarget = ApplyActionInput['targetType'];

/** Human-friendly label for a raw target-type string. */
function targetLabel(targetType: string): string {
  return targetType.replace(/_/g, ' ');
}

/** Map a report status to a Badge variant for at-a-glance triage. */
function statusVariant(status: ReportStatus): BadgeProps['variant'] {
  switch (status) {
    case 'open':
      return 'warning';
    case 'reviewing':
      return 'brand';
    case 'resolved':
      return 'success';
    case 'dismissed':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/**
 * Report queue with a Report_Context drawer (Req 7.1–7.3, 7.6, 9.4).
 *
 * Lists reports filtered by status (Req 9.4), pages via cursor "Load more"
 * (Req 9.2), and opens a context drawer resolving the reported content by kind
 * — transcript for messages, body + media refs for posts, summary + activity
 * for users, and a defined unavailable state for removed/purged content.
 */
export default function AdminReportsPage() {
  const [status, setStatus] = useState<ReportStatus>('open');
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AdminReport | null>(null);

  const loadFirstPage = useCallback((next: ReportStatus) => {
    setLoading(true);
    void adminApi
      .reports(next)
      .then((page) => {
        setReports(page.reports);
        setNextCursor(page.nextCursor);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadFirstPage(status);
  }, [status, loadFirstPage]);

  const loadMore = () => {
    if (!nextCursor) return;
    setLoading(true);
    void adminApi
      .reports(status, nextCursor)
      .then((page) => {
        setReports((prev) => [...prev, ...page.reports]);
        setNextCursor(page.nextCursor);
      })
      .finally(() => setLoading(false));
  };

  const refresh = () => loadFirstPage(status);

  /** Apply a moderation action to a report's target, then refresh the queue. */
  const act = async (report: AdminReport, action: ModerationActionType) => {
    await adminApi.applyAction({
      targetType: report.targetType as ApplyTarget,
      targetId: report.targetId,
      action,
      reportId: report.id,
      ...(action === 'ban' ? { durationHours: 24 } : {}),
    });
    setSelected(null);
    refresh();
  };

  /** Resolve or dismiss a report, then refresh the queue. */
  const resolve = async (report: AdminReport, next: 'resolved' | 'dismissed') => {
    await adminApi.resolveReport(report.id, next);
    setSelected(null);
    refresh();
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-space-5">
      <div className="flex flex-col gap-space-1">
        <h1 className="text-h1 text-foreground">Reports</h1>
        <p className="text-body text-muted-foreground">
          Review the report queue with full context before acting.
        </p>
      </div>

      {/* Status filter (Req 9.4) */}
      <div className="flex items-center gap-space-2">
        <label htmlFor="report-status-filter" className="text-caption text-muted-foreground">
          Status
        </label>
        <Select
          id="report-status-filter"
          aria-label="Filter reports by status"
          className="w-48"
          value={status}
          onChange={(event) => setStatus(event.target.value as ReportStatus)}
        >
          {REPORT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </option>
          ))}
        </Select>
      </div>

      {/* Queue */}
      {loading && reports.length === 0 ? (
        <p className="inline-flex items-center gap-space-2 py-space-8 text-caption text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading reports…
        </p>
      ) : reports.length === 0 ? (
        <p className="py-space-8 text-center text-caption text-muted-foreground">
          No {status} reports 🎉
        </p>
      ) : (
        <div className="flex flex-col gap-space-3">
          {reports.map((report) => (
            <Card key={report.id} className="flex flex-col gap-space-2">
              <div className="flex flex-wrap items-center justify-between gap-space-2">
                <CardTitle className="capitalize">{targetLabel(report.targetType)}</CardTitle>
                <div className="flex items-center gap-space-2">
                  <Badge variant="danger">{report.reason}</Badge>
                  <Badge variant={statusVariant(report.status)}>{report.status}</Badge>
                </div>
              </div>
              {report.details ? (
                <p className="text-body text-foreground">{report.details}</p>
              ) : null}
              <span className="text-small text-muted-foreground">
                Reported {new Date(report.createdAt).toLocaleString()}
              </span>
              <div className="flex flex-wrap gap-space-2 border-t border-border pt-space-2">
                <Button size="sm" onClick={() => setSelected(report)}>
                  View context
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void resolve(report, 'dismissed')}>
                  Dismiss
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void act(report, 'remove_content')}
                >
                  Remove content
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void act(report, 'warn')}>
                  Warn
                </Button>
                <Button size="sm" variant="danger" onClick={() => void act(report, 'ban')}>
                  Suspend 24h
                </Button>
              </div>
            </Card>
          ))}

          {nextCursor ? (
            <div className="flex justify-center pt-space-2">
              <Button variant="secondary" onClick={loadMore} disabled={loading}>
                {loading ? (
                  <span className="inline-flex items-center gap-space-2">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Loading…
                  </span>
                ) : (
                  'Load more'
                )}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <ReportContextDrawer
        report={selected}
        onClose={() => setSelected(null)}
        onAction={act}
        onResolve={resolve}
      />
    </div>
  );
}

interface ReportContextDrawerProps {
  report: AdminReport | null;
  onClose: () => void;
  onAction: (report: AdminReport, action: ModerationActionType) => Promise<void>;
  onResolve: (report: AdminReport, next: 'resolved' | 'dismissed') => Promise<void>;
}

/**
 * Context drawer: fetches Report_Context for the selected report and renders the
 * resolved content by kind, plus moderation actions (Req 7.1–7.3, 7.6).
 */
function ReportContextDrawer({ report, onClose, onAction, onResolve }: ReportContextDrawerProps) {
  const [context, setContext] = useState<ReportContext | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!report) {
      setContext(null);
      return;
    }
    setLoading(true);
    setContext(null);
    void adminApi
      .reportContext(report.id)
      .then(setContext)
      .finally(() => setLoading(false));
  }, [report]);

  const open = report !== null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={report ? `Report: ${targetLabel(report.targetType)}` : 'Report'}
      className="max-w-2xl"
    >
      {report ? (
        <div className="flex max-h-[70vh] flex-col gap-space-4 overflow-y-auto">
          {/* Report metadata */}
          <div className="flex flex-wrap items-center gap-space-2">
            <Badge variant="danger">{report.reason}</Badge>
            <Badge variant={statusVariant(report.status)}>{report.status}</Badge>
            <span className="text-small text-muted-foreground">
              {new Date(report.createdAt).toLocaleString()}
            </span>
          </div>
          {report.details ? <p className="text-body text-foreground">{report.details}</p> : null}

          {/* Resolved content */}
          <div className="border-t border-border pt-space-4">
            {loading ? (
              <p className="inline-flex items-center gap-space-2 text-caption text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Loading context…
              </p>
            ) : context ? (
              <ReportTargetContent context={context} />
            ) : (
              <p className="text-caption text-muted-foreground">Context unavailable.</p>
            )}
          </div>

          {/* Moderation actions */}
          <div className="flex flex-wrap gap-space-2 border-t border-border pt-space-4">
            <Button size="sm" variant="ghost" onClick={() => void onResolve(report, 'resolved')}>
              Mark resolved
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void onResolve(report, 'dismissed')}>
              Dismiss
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void onAction(report, 'remove_content')}
            >
              Remove content
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void onAction(report, 'warn')}>
              Warn
            </Button>
            <Button size="sm" variant="danger" onClick={() => void onAction(report, 'ban')}>
              Suspend 24h
            </Button>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

/** Renders the resolved report target by kind, or an unavailable state (Req 7.6). */
function ReportTargetContent({ context }: { context: ReportContext }) {
  const { target } = context;

  if (target.contentUnavailable) {
    return (
      <div className="flex items-center gap-space-2 rounded-card border border-border bg-muted px-space-4 py-space-3">
        <Ban className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-body text-muted-foreground">
          Content unavailable (removed or purged).
        </span>
      </div>
    );
  }

  switch (target.kind) {
    case 'message':
      return <TranscriptView messages={target.transcript ?? []} />;
    case 'wall_post':
    case 'wall_reply':
    case 'community_post':
      return <PostContentView content={target.content} />;
    case 'user':
      return <UserContentView content={target.content} />;
    default:
      return (
        <p className="text-caption text-muted-foreground">
          No renderable context for this report type.
        </p>
      );
  }
}

/** Message target: transcript window with the reported message highlighted. */
function TranscriptView({ messages }: { messages: TranscriptMessage[] }) {
  if (messages.length === 0) {
    return <p className="text-caption text-muted-foreground">No messages in this window.</p>;
  }
  return (
    <div className="flex flex-col gap-space-2">
      <div className="flex items-center gap-space-2 text-caption text-muted-foreground">
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        <span>Conversation transcript</span>
      </div>
      <ul className="flex flex-col gap-space-2">
        {messages.map((message) => (
          <li
            key={message.id}
            className={cn(
              'rounded-card border px-space-3 py-space-2',
              message.isReported ? 'border-danger bg-danger/10' : 'border-border bg-background',
            )}
          >
            <div className="flex items-center justify-between gap-space-2">
              <span className="text-small font-medium text-foreground">
                {message.senderId}
                {message.isReported ? (
                  <Badge variant="danger" className="ml-space-2">
                    reported
                  </Badge>
                ) : null}
              </span>
              <span className="text-small text-muted-foreground">
                {new Date(message.createdAt).toLocaleString()}
              </span>
            </div>
            {message.body ? (
              <p className="mt-space-1 whitespace-pre-wrap text-body text-foreground">
                {message.body}
              </p>
            ) : null}
            {message.attachment ? (
              <p className="mt-space-1 text-small text-muted-foreground">
                {message.attachment.kind} attachment · {message.attachment.mimeType} (media{' '}
                {message.attachment.mediaId})
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shape of resolved post-like content (defensive; ReportContext.content is unknown). */
interface PostLikeContent {
  body?: string | null;
  mediaIds?: string[];
  status?: string;
  authorId?: string | null;
  isAnonymous?: boolean;
  createdAt?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function toPostLike(content: unknown): PostLikeContent {
  const record = asRecord(content);
  const mediaIds = Array.isArray(record.mediaIds)
    ? record.mediaIds.filter((id): id is string => typeof id === 'string')
    : [];
  return {
    body: typeof record.body === 'string' ? record.body : null,
    mediaIds,
    status: typeof record.status === 'string' ? record.status : undefined,
    authorId: typeof record.authorId === 'string' ? record.authorId : null,
    isAnonymous: typeof record.isAnonymous === 'boolean' ? record.isAnonymous : undefined,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : undefined,
  };
}

/** Post / reply target: full text plus media references (Req 7.3). */
function PostContentView({ content }: { content: unknown }) {
  const post = toPostLike(content);
  return (
    <div className="flex flex-col gap-space-3">
      <div className="flex items-center gap-space-2 text-caption text-muted-foreground">
        <FileText className="h-4 w-4" aria-hidden="true" />
        <span>Reported content</span>
      </div>
      <div className="rounded-card border border-border bg-background px-space-4 py-space-3">
        {post.body ? (
          <p className="whitespace-pre-wrap text-body text-foreground">{post.body}</p>
        ) : (
          <p className="text-caption text-muted-foreground">No text content.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-space-2 text-small text-muted-foreground">
        {post.status ? <Badge variant="neutral">{post.status}</Badge> : null}
        {post.isAnonymous ? <Badge variant="neutral">anonymous</Badge> : null}
        {post.authorId ? <span>author: {post.authorId}</span> : null}
        {post.createdAt ? <span>{new Date(post.createdAt).toLocaleString()}</span> : null}
      </div>
      {post.mediaIds && post.mediaIds.length > 0 ? (
        <div className="flex flex-col gap-space-1">
          <span className="text-caption text-muted-foreground">Media references</span>
          <ul className="flex flex-wrap gap-space-2">
            {post.mediaIds.map((mediaId) => (
              <li key={mediaId}>
                <Badge variant="neutral">{mediaId}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Shape of resolved user content (defensive; ReportContext.content is unknown). */
interface UserLikeContent {
  name?: string;
  email?: string;
  role?: string;
  accountStatus?: string;
  createdAt?: string;
  recentActivity?: unknown[];
}

function toUserLike(content: unknown): UserLikeContent {
  const record = asRecord(content);
  const user = asRecord(record.user ?? record);
  const activity = record.recentActivity ?? record.activity;
  return {
    name: typeof user.name === 'string' ? user.name : undefined,
    email: typeof user.email === 'string' ? user.email : undefined,
    role: typeof user.role === 'string' ? user.role : undefined,
    accountStatus: typeof user.accountStatus === 'string' ? user.accountStatus : undefined,
    createdAt: typeof user.createdAt === 'string' ? user.createdAt : undefined,
    recentActivity: Array.isArray(activity) ? activity : [],
  };
}

/** User target: summary plus recent reportable activity (Req 7.4). */
function UserContentView({ content }: { content: unknown }) {
  const user = toUserLike(content);
  const activity = user.recentActivity ?? [];
  return (
    <div className="flex flex-col gap-space-3">
      <div className="flex items-center gap-space-2 text-caption text-muted-foreground">
        <UserIcon className="h-4 w-4" aria-hidden="true" />
        <span>Reported user</span>
      </div>
      <div className="rounded-card border border-border bg-background px-space-4 py-space-3">
        <p className="text-body font-medium text-foreground">{user.name ?? 'Unknown user'}</p>
        <p className="text-small text-muted-foreground">
          {[user.email, user.role, user.accountStatus].filter(Boolean).join(' · ')}
        </p>
        {user.createdAt ? (
          <p className="mt-space-1 text-small text-muted-foreground">
            Joined {new Date(user.createdAt).toLocaleString()}
          </p>
        ) : null}
      </div>
      {activity.length > 0 ? (
        <div className="flex flex-col gap-space-1">
          <span className="text-caption text-muted-foreground">Recent activity</span>
          <ul className="flex flex-col gap-space-1">
            {activity.map((item, index) => {
              const record = asRecord(item);
              const id = typeof record.id === 'string' ? record.id : String(index);
              const summary =
                typeof record.body === 'string'
                  ? record.body
                  : typeof record.action === 'string'
                    ? record.action
                    : JSON.stringify(item);
              return (
                <li
                  key={id}
                  className="rounded-card border border-border bg-background px-space-3 py-space-2 text-small text-foreground"
                >
                  {summary}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-caption text-muted-foreground">No recent activity to show.</p>
      )}
    </div>
  );
}
