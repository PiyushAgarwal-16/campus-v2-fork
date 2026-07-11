'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText, Users, Image as ImageIcon, MessagesSquare, ExternalLink } from 'lucide-react';
import type {
  InspectedPost,
  InspectedMediaMeta,
  ConversationTranscript,
  InspectConversationInput,
} from '@campusly/shared-types';
import { adminApi } from '../../../lib/admin';
import { DataTable, type DataTableColumn } from '../../../components/admin/DataTable';
import { Card, CardTitle, CardDescription } from '../../../components/ui/Card';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { Textarea } from '../../../components/ui/Textarea';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../lib/utils';

/**
 * Data inspector page (Req 8.1, 8.2, 8.3, 8.5). Rendered inside the guarded
 * `/admin` layout, so it renders neither the student `AppNav` nor its own auth
 * redirect. All record browsing here is read-only. Conversation inspection is
 * moderator-scoped and audited.
 */

type RecordTab = 'wall' | 'community' | 'media';

const TABS: { id: RecordTab; label: string; icon: typeof FileText }[] = [
  { id: 'wall', label: 'Wall posts', icon: FileText },
  { id: 'community', label: 'Community posts', icon: Users },
  { id: 'media', label: 'Media', icon: ImageIcon },
];

export default function AdminInspectorPage() {
  const [tab, setTab] = useState<RecordTab>('wall');

  return (
    <div className="flex flex-col gap-space-6">
      <div className="flex flex-col gap-space-1">
        <h1 className="text-h1 text-foreground">Data inspector</h1>
        <p className="text-body text-muted-foreground">
          Read-only inspection of platform records. Conversation inspection is moderator-scoped and
          audited.
        </p>
      </div>

      <section aria-label="Records" className="flex flex-col gap-space-3">
        <div role="tablist" aria-label="Record type" className="flex flex-wrap gap-space-2">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(id)}
                className={cn(
                  'inline-flex min-h-11 items-center gap-space-2 rounded-button border px-space-3 py-space-2 text-body font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                  active
                    ? 'border-brand bg-brand/10 text-brand'
                    : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {tab === 'wall' ? <PostsTable kind="wall" /> : null}
        {tab === 'community' ? <PostsTable kind="community" /> : null}
        {tab === 'media' ? <MediaTable /> : null}
      </section>

      <ConversationInspectionPanel />
    </div>
  );
}

/** Shared cursor-pagination state hook for a single record surface. */
function usePaginatedRecords<T>(
  fetcher: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
) {
  const [rows, setRows] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const fetchPage = useCallback(
    async (next: string | null) => {
      setLoading(true);
      try {
        const res = await fetcher(next ?? undefined);
        setRows((prev) => (next ? [...prev, ...res.items] : res.items));
        setCursor(res.nextCursor);
        setHasMore(res.nextCursor !== null);
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    },
    [fetcher],
  );

  useEffect(() => {
    void fetchPage(null);
  }, [fetchPage]);

  return { rows, cursor, hasMore, loading, loaded, loadMore: () => void fetchPage(cursor) };
}

/** Small tombstone indicator for purged records (Req 8.6). */
function Tombstone() {
  return <Badge variant="warning">Content unavailable</Badge>;
}

function PostsTable({ kind }: { kind: 'wall' | 'community' }) {
  const fetcher = useCallback(
    (cursor?: string) =>
      kind === 'wall' ? adminApi.inspectorPosts(cursor) : adminApi.inspectorCommunityPosts(cursor),
    [kind],
  );
  const { rows, hasMore, loading, loaded, loadMore } = usePaginatedRecords<InspectedPost>(fetcher);

  const columns: DataTableColumn<InspectedPost>[] = [
    { label: 'Kind', render: (p) => p.kind },
    {
      label: 'Author',
      render: (p) =>
        p.isAnonymous ? (
          <Badge variant="neutral">Anonymous</Badge>
        ) : (
          <span className="text-body text-foreground">{p.authorId ?? '—'}</span>
        ),
    },
    {
      label: 'Body',
      render: (p) =>
        p.contentUnavailable ? (
          <Tombstone />
        ) : (
          <span className="line-clamp-2 max-w-md text-body text-foreground">{p.body ?? '—'}</span>
        ),
    },
    { label: 'Status', render: (p) => <Badge variant="neutral">{p.status}</Badge> },
    {
      label: 'Created',
      render: (p) => (
        <span className="text-caption text-muted-foreground">
          {new Date(p.createdAt).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(p) => p.id}
      hasMore={hasMore}
      onLoadMore={loadMore}
      loading={loading}
      emptyState={loaded ? 'No records to display.' : 'Loading records…'}
    />
  );
}

function MediaTable() {
  const { rows, hasMore, loading, loaded, loadMore } = usePaginatedRecords<InspectedMediaMeta>(
    adminApi.inspectorMedia,
  );

  const openSignedUrl = async (id: string) => {
    const { url } = await adminApi.mediaUrl(id);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const columns: DataTableColumn<InspectedMediaMeta>[] = [
    { label: 'Kind', render: (m) => m.kind },
    { label: 'MIME type', render: (m) => m.mimeType },
    { label: 'Status', render: (m) => <Badge variant="neutral">{m.status}</Badge> },
    { label: 'Owner', render: (m) => m.ownerId ?? '—' },
    {
      label: 'Created',
      render: (m) => (
        <span className="text-caption text-muted-foreground">
          {new Date(m.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      label: 'URL',
      render: (m) =>
        m.contentUnavailable ? (
          <Tombstone />
        ) : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void openSignedUrl(m.id)}
            aria-label={`Get signed URL for media ${m.id}`}
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Get URL
          </Button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-space-2">
      <CardDescription>Signed media URLs are short-lived and expire quickly.</CardDescription>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(m) => m.id}
        hasMore={hasMore}
        onLoadMore={loadMore}
        loading={loading}
        emptyState={loaded ? 'No media to display.' : 'Loading media…'}
      />
    </div>
  );
}

function ConversationInspectionPanel() {
  const [contextType, setContextType] = useState<'anon_session' | 'friendship'>('anon_session');
  const [conversationId, setConversationId] = useState('');
  const [reportId, setReportId] = useState('');
  const [investigationContext, setInvestigationContext] = useState('');
  const [transcript, setTranscript] = useState<ConversationTranscript | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasScope = reportId.trim().length > 0 || investigationContext.trim().length > 0;
  const canInspect = conversationId.trim().length > 0 && hasScope && !loading;

  const inspect = async () => {
    if (!canInspect) return;
    setLoading(true);
    setError(null);
    const input: InspectConversationInput = {
      contextType,
      conversationId: conversationId.trim(),
      ...(reportId.trim() ? { reportId: reportId.trim() } : {}),
      ...(investigationContext.trim() ? { investigationContext: investigationContext.trim() } : {}),
    };
    try {
      const res = await adminApi.inspectConversation(input);
      setTranscript(res);
    } catch {
      setTranscript(null);
      setError('Could not load that conversation. Check the id and your scope.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-label="Conversation inspection" className="flex flex-col gap-space-3">
      <div className="flex items-center gap-space-2">
        <MessagesSquare className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-h3 text-foreground">Conversation inspection</h2>
      </div>

      <Card className="flex flex-col gap-space-4">
        <CardDescription>
          Moderator-scoped and audited. Provide a report id or an investigation context to justify
          access; conversation browsing is never open-ended.
        </CardDescription>

        <div className="grid grid-cols-1 gap-space-3 sm:grid-cols-2">
          <div className="flex flex-col gap-space-1">
            <label
              htmlFor="inspect-context-type"
              className="text-caption font-medium text-foreground"
            >
              Context type
            </label>
            <Select
              id="inspect-context-type"
              value={contextType}
              onChange={(e) =>
                setContextType(e.target.value === 'friendship' ? 'friendship' : 'anon_session')
              }
            >
              <option value="anon_session">Anonymous session</option>
              <option value="friendship">Friendship</option>
            </Select>
          </div>

          <div className="flex flex-col gap-space-1">
            <label
              htmlFor="inspect-conversation-id"
              className="text-caption font-medium text-foreground"
            >
              Conversation id
            </label>
            <Input
              id="inspect-conversation-id"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              placeholder="Conversation id (UUID)"
            />
          </div>

          <div className="flex flex-col gap-space-1">
            <label htmlFor="inspect-report-id" className="text-caption font-medium text-foreground">
              Report id
            </label>
            <Input
              id="inspect-report-id"
              value={reportId}
              onChange={(e) => setReportId(e.target.value)}
              placeholder="Report id (UUID)"
            />
          </div>

          <div className="flex flex-col gap-space-1">
            <label
              htmlFor="inspect-investigation"
              className="text-caption font-medium text-foreground"
            >
              Investigation context
            </label>
            <Textarea
              id="inspect-investigation"
              value={investigationContext}
              onChange={(e) => setInvestigationContext(e.target.value)}
              placeholder="Why this inspection is needed"
              maxLength={500}
            />
          </div>
        </div>

        {!hasScope ? (
          <p className="text-caption text-muted-foreground">
            Provide a report id or an investigation context to enable inspection.
          </p>
        ) : null}
        {error ? <p className="text-caption text-danger">{error}</p> : null}

        <div className="flex justify-end">
          <Button onClick={() => void inspect()} disabled={!canInspect}>
            Inspect conversation
          </Button>
        </div>
      </Card>

      {transcript ? <TranscriptView transcript={transcript} /> : null}
    </section>
  );
}

function TranscriptView({ transcript }: { transcript: ConversationTranscript }) {
  return (
    <Card className="flex flex-col gap-space-3">
      <CardTitle>Transcript</CardTitle>
      {transcript.contentUnavailable ? (
        <Tombstone />
      ) : transcript.messages.length === 0 ? (
        <p className="text-caption text-muted-foreground">No messages in this window.</p>
      ) : (
        <ul className="flex flex-col gap-space-2">
          {transcript.messages.map((m) => (
            <li
              key={m.id}
              className={cn(
                'rounded-card border border-border p-space-3',
                m.isReported && 'border-danger',
              )}
            >
              <div className="flex items-center justify-between gap-space-2">
                <span className="text-caption text-muted-foreground">{m.senderId}</span>
                <span className="text-small text-muted-foreground">
                  {new Date(m.createdAt).toLocaleString()}
                </span>
              </div>
              <p className="mt-space-1 text-body text-foreground">
                {m.body ?? <span className="text-muted-foreground">[{m.type}]</span>}
              </p>
              {m.isReported ? (
                <span className="mt-space-1 inline-block">
                  <Badge variant="danger">Reported</Badge>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
