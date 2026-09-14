import { type ReactNode } from 'react';
import { Label } from '@/components/ui/label';

/**
 * A labelled field with optional help and error text. The control receives `id`, `aria-describedby` and
 * `aria-invalid` so assistive tech reads the help and error with it.
 */
export function FormField({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  children: (props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode;
}) {
  const helpId = help ? `${id}-help` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {help && (
        <p id={helpId} className="text-sm text-muted-foreground">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Save status for a form, announced politely. */
export function SaveStatus({
  state,
}: {
  state: { kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string };
}) {
  return (
    <div aria-live="polite" className="text-sm">
      {state.kind === 'saved' && <p className="text-muted-foreground">Saved.</p>}
      {state.kind === 'error' && (
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
      )}
    </div>
  );
}
