import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { cn } from '../../lib/utils';

/**
 * Table primitives (UI_GUIDELINES.md §3 tokens, dividers over heavy borders).
 * Lightweight composable set: Table + THead + TBody + TR + TH + TD.
 */
export const Table = forwardRef<HTMLTableElement, HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <table
      ref={ref}
      className={cn('w-full border-collapse text-body text-foreground', className)}
      {...props}
    />
  ),
);
Table.displayName = 'Table';

export const THead = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead ref={ref} className={cn('border-b border-divider', className)} {...props} />
  ),
);
THead.displayName = 'THead';

export const TBody = forwardRef<HTMLTableSectionElement, HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody ref={ref} className={cn('divide-y divide-divider', className)} {...props} />
  ),
);
TBody.displayName = 'TBody';

export const TR = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr ref={ref} className={cn('transition-colors hover:bg-muted/50', className)} {...props} />
  ),
);
TR.displayName = 'TR';

export const TH = forwardRef<HTMLTableCellElement, ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, scope = 'col', ...props }, ref) => (
    <th
      ref={ref}
      scope={scope}
      className={cn(
        'px-space-3 py-space-2 text-left text-caption font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  ),
);
TH.displayName = 'TH';

export const TD = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn('px-space-3 py-space-3 align-middle', className)} {...props} />
  ),
);
TD.displayName = 'TD';
