'use client';

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ForwardedRef,
  type HTMLAttributes,
  type MutableRefObject,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Whether the dialog is visible. */
  open: boolean;
  /** Called when the user requests to close (overlay click, Escape, or close button). */
  onClose: () => void;
  /** Optional heading rendered in the panel and used as the accessible name. */
  title?: string;
}

/**
 * Dialog primitive — a controlled modal (UI_GUIDELINES.md §7: 16px radius, §14 a11y).
 * Fixed-position overlay + centered panel; closes on overlay click and Escape.
 * Accessible: role="dialog", aria-modal, labelled by the title when provided.
 */
export const Dialog = forwardRef<HTMLDivElement, DialogProps>(
  ({ open, onClose, title, className, children, ...props }, ref) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const titleId = useId();

    useEffect(() => {
      if (!open) return;
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') onClose();
      };
      document.addEventListener('keydown', onKeyDown);
      panelRef.current?.focus();
      return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-space-4"
        onClick={onClose}
      >
        <div
          ref={mergeRefs(ref, panelRef)}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-label={title ? undefined : 'Dialog'}
          tabIndex={-1}
          onClick={(event) => event.stopPropagation()}
          className={cn(
            'relative w-full max-w-md rounded-dialog border border-border bg-surface p-space-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            className,
          )}
          {...props}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="absolute right-space-3 top-space-3 inline-flex h-11 w-11 items-center justify-center rounded-button text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          {title ? (
            <h2 id={titleId} className="mb-space-4 pr-space-8 text-h3 text-foreground">
              {title}
            </h2>
          ) : null}
          {children}
        </div>
      </div>
    );
  },
);
Dialog.displayName = 'Dialog';

/** Merge a forwarded ref with a local ref so both receive the node. */
function mergeRefs<T>(
  external: ForwardedRef<T>,
  local: MutableRefObject<T | null>,
): (node: T | null) => void {
  return (node) => {
    local.current = node;
    if (typeof external === 'function') {
      external(node);
    } else if (external) {
      external.current = node;
    }
  };
}
