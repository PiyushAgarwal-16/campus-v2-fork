'use client';

import { useCallback, useEffect, useState } from 'react';
import { ScrollText } from 'lucide-react';
import type { AuditLogItem } from '@campusly/shared-types';
import { adminApi } from '../../../lib/admin';
import { DataTable, type DataTableColumn } from '../../../components/admin/DataTable';
import { Badge } from '../../../components/ui/Badge';

/**
 * Audit log page (Req 13.4). Rendered inside the guarded `/admin` layout, so it
 * renders neither the student `AppNav` nor its own auth redirect.
 *
 * Shows the append-only audit trail in reverse-chronological order with
 * cursor-based "Load more" pagination.
 */
export default function AdminAuditPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const fetchPage = useCallback(async (next: string | null) => {
    setLoading(true);
    try {
      const res = await adminApi.auditLogs(next ?? undefined);
      setLogs((prev) => (next ? [...prev, ...res.logs] : res.logs));
      setCursor(res.nextCursor);
      setHasMore(res.nextCursor !== null);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void fetchPage(null);
  }, [fetchPage]);

  const columns: DataTableColumn<AuditLogItem>[] = [
    {
      label: 'Action',
      render: (log) => <Badge variant="neutral">{log.action}</Badge>,
    },
    {
      label: 'Actor',
      render: (log) => (
        <span className="text-body text-foreground">
          {log.actorId ?? <span className="text-muted-foreground">system</span>}
        </span>
      ),
    },
    {
      label: 'Target',
      render: (log) =>
        log.targetType || log.targetId ? (
          <span className="text-body text-foreground">
            {log.targetType ?? '—'}
            {log.targetId ? <span className="text-muted-foreground"> · {log.targetId}</span> : null}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      label: 'Time',
      render: (log) => (
        <span className="text-caption text-muted-foreground">
          {new Date(log.createdAt).toLocaleString()}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-space-6">
      <div className="flex flex-col gap-space-1">
        <div className="flex items-center gap-space-2">
          <ScrollText className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-h1 text-foreground">Audit log</h1>
        </div>
        <p className="text-body text-muted-foreground">
          Every privileged action, most recent first.
        </p>
      </div>

      <DataTable
        columns={columns}
        rows={logs}
        rowKey={(log) => log.id}
        hasMore={hasMore}
        onLoadMore={() => void fetchPage(cursor)}
        loading={loading}
        emptyState={loaded ? 'No audit entries yet.' : 'Loading audit entries…'}
      />
    </div>
  );
}
