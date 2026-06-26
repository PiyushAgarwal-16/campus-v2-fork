import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Card primitive (UI_GUIDELINES.md §7: 12px radius; §8: minimal elevation —
 * rely on background contrast over heavy shadows).
 */
export const Card = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-card border border-border bg-surface p-space-5', className)}
      {...props}
    />
  ),
);
Card.displayName = 'Card';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-h3 text-foreground', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-caption text-muted-foreground', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';
