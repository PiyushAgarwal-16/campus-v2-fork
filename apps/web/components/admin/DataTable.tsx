'use client';

import { type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { Table, THead, TBody, TR, TH, TD } from '../ui/Table';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';

/** A single column definition: a header label and a per-row cell renderer. */
export interface DataTableColumn<T> {
  /** Column header text (also used as the accessible column name). */
  label: string;
  /** Renders the cell content for a given row. */
  render: (row: T) => ReactNode;
  /** Optional className applied to the cell (`<td>`) for this column. */
  className?: string;
}

export interface DataTableProps<T> {
  /** Column definitions in display order. */
  columns: DataTableColumn<T>[];
  /** The rows to render. */
  rows: T[];
  /** Stable key extractor for each row. */
  rowKey: (row: T) => string;
  /** Whether more rows can be fetched (cursor-based pagination). */
  hasMore?: boolean;
  /** Called when the operator requests the next page. */
  onLoadMore?: () => void;
  /** Whether a load is in flight (disables the load-more button, shows spinner). */
  loading?: boolean;
  /** Content shown when there are no rows and nothing is loading. */
  emptyState?: ReactNode;
  /** Optional className applied to the wrapping element. */
  className?: string;
}

/**
 * DataTable — a generic, cursor-paginated table wrapper over the ui/Table
 * primitives (Req 15.x). Renders columns/rows, an empty state, and a
 * "Load more" control shown when `hasMore` is true.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  hasMore = false,
  onLoadMore,
  loading = false,
  emptyState = 'No records to display.',
  className,
}: DataTableProps<T>) {
  const isEmpty = rows.length === 0;

  return (
    <div className={cn('space-y-space-4', className)}>
      <div className="overflow-x-auto rounded-card border border-border">
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              {columns.map((column) => (
                <TH key={column.label}>{column.label}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {isEmpty ? (
              <TR className="hover:bg-transparent">
                <TD colSpan={columns.length} className="py-space-6 text-center">
                  {loading ? (
                    <span className="inline-flex items-center gap-space-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Loading…
                    </span>
                  ) : (
                    <span className="text-caption text-muted-foreground">{emptyState}</span>
                  )}
                </TD>
              </TR>
            ) : (
              rows.map((row) => (
                <TR key={rowKey(row)}>
                  {columns.map((column) => (
                    <TD key={column.label} className={column.className}>
                      {column.render(row)}
                    </TD>
                  ))}
                </TR>
              ))
            )}
          </TBody>
        </Table>
      </div>

      {hasMore && !isEmpty ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={onLoadMore} disabled={loading}>
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
  );
}
