import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { Card } from '../ui/Card';
import { cn } from '../../lib/utils';

export interface StatCardProps {
  /** The metric label (e.g. "Pending reports"). */
  label: string;
  /** The metric value (formatted by the caller). */
  value: ReactNode;
  /**
   * Visual emphasis. 'highlight' draws attention to a safety-relevant metric
   * (e.g. the pending-reports indicator). Defaults to 'default'.
   */
  emphasis?: 'default' | 'highlight';
  /** Optional leading icon. */
  icon?: LucideIcon;
  /** Optional className applied to the card. */
  className?: string;
}

/**
 * StatCard — a dashboard metric card built on the Card primitive (Req 15.x).
 * Shows a label + value with an optional icon and an optional highlight
 * treatment for safety indicators.
 */
export function StatCard({
  label,
  value,
  emphasis = 'default',
  icon: Icon,
  className,
}: StatCardProps) {
  const highlighted = emphasis === 'highlight';

  return (
    <Card className={cn(highlighted && 'border-brand/40 bg-brand/5', className)}>
      <div className="flex items-start justify-between gap-space-3">
        <div className="space-y-space-1">
          <p className="text-caption font-medium text-muted-foreground">{label}</p>
          <p
            className={cn('text-h2 font-semibold', highlighted ? 'text-brand' : 'text-foreground')}
          >
            {value}
          </p>
        </div>
        {Icon ? (
          <span
            className={cn(
              'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-button',
              highlighted ? 'bg-brand/15 text-brand' : 'bg-muted text-muted-foreground',
            )}
            aria-hidden="true"
          >
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
      </div>
    </Card>
  );
}
