import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

/**
 * Button primitive (UI_GUIDELINES.md §7 radius, §10 components).
 * Orange is the primary action; used sparingly for maximum impact (§3).
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-space-2 rounded-button text-button font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-foreground hover:bg-brand/90',
        secondary: 'bg-surface text-foreground border border-border hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        danger: 'bg-danger text-white hover:bg-danger/90',
      },
      size: {
        sm: 'h-9 px-space-3',
        md: 'h-10 px-space-4 py-space-2',
        lg: 'h-12 px-space-6',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  ),
);
Button.displayName = 'Button';
