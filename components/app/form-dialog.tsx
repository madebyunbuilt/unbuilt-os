'use client';

import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/convex-error';

// A form inside a dialog, with its own error and busy state, shared by every screen that asks for a few fields and
// calls one mutation (invoices, expenses, bills).

/** A form in a dialog, with its own error and busy state. */
export function FormDialog({
  trigger,
  title,
  description,
  submitLabel,
  canSubmit = true,
  onSubmit,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  submitLabel: string;
  canSubmit?: boolean;
  onSubmit: () => Promise<unknown>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const id = `form-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          id={id}
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            try {
              await onSubmit();
              setOpen(false);
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          {children}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={id} disabled={saving || !canSubmit}>
            {saving ? 'Working…' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
