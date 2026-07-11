'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button, type ButtonProps } from '../ui/Button';
import { Textarea } from '../ui/Textarea';
import { cn } from '../../lib/utils';

export interface ConfirmDialogProps {
  /** Whether the confirmation dialog is visible. */
  open: boolean;
  /** Called when the operator dismisses the dialog without confirming. */
  onClose: () => void;
  /** Called with the (optional) reason when the operator confirms. */
  onConfirm: (reason: string) => void;
  /** Names the action being taken (used as the dialog title). */
  title: string;
  /** Describes the action and the target it affects. */
  description: string;
  /** A short note describing whether the action can be undone. */
  reversibility: string;
  /** When true, the operator must supply a non-empty reason to confirm. */
  requireReason?: boolean;
  /** Label for the reason textarea. */
  reasonLabel?: string;
  /** Confirm button label. Defaults to the title. */
  confirmLabel?: string;
  /** Confirm button variant. Defaults to the destructive 'danger' style. */
  confirmVariant?: ButtonProps['variant'];
}

/**
 * ConfirmDialog — a destructive-action confirmation (Req 12.1).
 *
 * Built on the Dialog primitive. It names the action, target, and reversibility
 * of a Destructive_Action and can collect a required reason before submission.
 * Confirming is blocked while `requireReason` is true and the reason is empty.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  reversibility,
  requireReason = false,
  reasonLabel = 'Reason',
  confirmLabel,
  confirmVariant = 'danger',
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');

  // Reset the reason whenever the dialog is (re)opened so state never leaks
  // between separate confirmations.
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  const trimmedReason = reason.trim();
  const reasonMissing = requireReason && trimmedReason.length === 0;

  const handleConfirm = () => {
    if (reasonMissing) return;
    onConfirm(trimmedReason);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="space-y-space-4">
        <div className="flex items-start gap-space-3">
          <span
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-button bg-danger/15 text-danger"
            aria-hidden="true"
          >
            <AlertTriangle className="h-5 w-5" />
          </span>
          <div className="space-y-space-2">
            <p className="text-body text-foreground">{description}</p>
            <p className="text-caption text-muted-foreground">{reversibility}</p>
          </div>
        </div>

        {requireReason ? (
          <div className="space-y-space-1">
            <label
              htmlFor="confirm-dialog-reason"
              className="block text-caption font-medium text-foreground"
            >
              {reasonLabel}
            </label>
            <Textarea
              id="confirm-dialog-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-required="true"
              aria-invalid={reasonMissing}
              placeholder="Explain why this action is being taken"
            />
          </div>
        ) : null}

        <div className="flex justify-end gap-space-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={reasonMissing}
            className={cn(reasonMissing && 'pointer-events-none')}
          >
            {confirmLabel ?? title}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
