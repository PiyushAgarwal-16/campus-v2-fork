import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Badge primitive — a small status pill (UI_GUIDELINES.md §3 states, §7 radius).
 * Semantic colors only; used to convey status at a glance in admin tables.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-space-1 rounded-button px-space-2 py-space-1 text-small font-medium',
  {
    variants: {
      variant: {
        neutral: 'bg-muted text-muted-foreground',
        brand: 'bg-brand text-brand-foreground',
        success: 'bg-success/15 text-success',
        warning: 'bg-warning/15 text-warning',
        danger: 'bg-danger/15 text-danger',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';
