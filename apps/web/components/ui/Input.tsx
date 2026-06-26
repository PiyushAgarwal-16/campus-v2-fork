import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/**
 * Input primitive (UI_GUIDELINES.md §7: 8px radius, matches buttons).
 * 44px min touch target via h-11 for accessibility (§14).
 */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-11 w-full rounded-input border border-border bg-background px-space-3 text-body text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
