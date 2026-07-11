import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Select primitive — a styled native <select> (UI_GUIDELINES.md §7: 8px radius,
 * matches Input). 44px min touch target via h-11 for accessibility (§14).
 * Native element kept intentionally simple (no custom popover).
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-input border border-border bg-background px-space-3 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = 'Select';
