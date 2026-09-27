'use client';

import { useAction } from 'convex/react';
import { ConvexError } from 'convex/values';
import { Check, Copy, Eye } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';

// Showing a secret, then taking it away again (10-vault.md, Access). The value is asked for only when somebody presses
// the button, is never held in a query, and goes out of React state when the window closes. How long it stays is the
// server's answer, not this component's opinion.

type Revealed = { username?: string; secret: string; notes?: string; hideAfterMs: number };

function errorCode(error: unknown): string | null {
  return error instanceof ConvexError ? ((error.data as { code?: string }).code ?? null) : null;
}

/** One value, with its own show-and-hide button. Copying is reported, because the spec logs it separately. */
function SecretRow({
  label,
  value,
  itemId,
  onCopied,
}: {
  label: string;
  value: string;
  itemId: Id<'vaultItems'>;
  onCopied: (itemId: Id<'vaultItems'>) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-start gap-2">
        {/* Selectable and wrapping: an SSH key or an env file is long, and a value nobody can select is no use. */}
        <code className="min-w-0 flex-1 rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">{value}</code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
            } catch {
              // A browser that refuses the clipboard is not a reason to lose the value on screen.
            }
            setCopied(true);
            onCopied(itemId);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

export function RevealPanel({ itemId }: { itemId: Id<'vaultItems'> }) {
  const reveal = useAction(api.vault.reveal);
  const recordCopy = useAction(api.vault.recordCopy);
  const [value, setValue] = useState<Revealed | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [pending, setPending] = useState(false);
  const [needsCode, setNeedsCode] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const hideAt = useRef<number>(0);

  const ask = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const result = await reveal({ itemId });
      setValue(result);
      hideAt.current = Date.now() + result.hideAfterMs;
      setSecondsLeft(Math.ceil(result.hideAfterMs / 1000));
      setNeedsCode(false);
      setCode('');
    } catch (caught) {
      const code = errorCode(caught);
      if (code === 'vault.twoFactorRequired') {
        setNeedsCode(true);
      } else {
        setError(
          code === 'vault.notFound'
            ? 'This item is not available to you.'
            : 'That did not work. Try again in a moment.',
        );
      }
    } finally {
      setPending(false);
    }
  }, [itemId, reveal]);

  // The countdown, and the hiding itself. Reading the deadline rather than counting ticks means a tab that was
  // backgrounded comes back with the value already gone, instead of with seconds it never spent.
  useEffect(() => {
    if (!value) return;
    const tick = () => {
      const left = hideAt.current - Date.now();
      if (left <= 0) {
        setValue(null);
        setSecondsLeft(0);
        return;
      }
      setSecondsLeft(Math.ceil(left / 1000));
    };
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [value]);

  if (needsCode) {
    return (
      <form
        className="space-y-3 rounded-lg border border-dashed p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          // Better Auth checks the code against the authenticator and records it; this page is never told to trust it.
          const { error: failed } = await authClient.twoFactor.verifyTotp({ code });
          setPending(false);
          if (failed) {
            setError('That code did not work. Check your authenticator and try again.');
            return;
          }
          await ask();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor={`code-${itemId}`}>Enter your authenticator code to see this</Label>
          <Input
            id={`code-${itemId}`}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="max-w-32 font-mono tracking-widest"
          />
          <p className="text-sm text-muted-foreground">
            Your last check was more than 15 minutes ago. Codes are asked for again so a session left open cannot be
            used to read credentials.
          </p>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={code.length !== 6 || pending}>
            {pending ? 'Checking…' : 'Check and show'}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setNeedsCode(false)}>
            Cancel
          </Button>
        </div>
      </form>
    );
  }

  if (!value) {
    return (
      <div className="space-y-2">
        <Button type="button" onClick={ask} disabled={pending}>
          <Eye aria-hidden />
          {pending ? 'Checking…' : 'Reveal'}
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <p className="text-sm text-muted-foreground">Every reveal is recorded against your name.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      {value.username !== undefined && (
        <SecretRow
          label="Username"
          value={value.username}
          itemId={itemId}
          onCopied={(id) => void recordCopy({ itemId: id })}
        />
      )}
      <SecretRow
        label="Secret"
        value={value.secret}
        itemId={itemId}
        onCopied={(id) => void recordCopy({ itemId: id })}
      />
      {value.notes !== undefined && (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Notes</p>
          <p className="text-sm whitespace-pre-wrap">{value.notes}</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t pt-3">
        <p aria-live="polite" className="text-sm text-muted-foreground">
          Hiding in {secondsLeft} {secondsLeft === 1 ? 'second' : 'seconds'}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setValue(null)}>
          Hide now
        </Button>
      </div>
    </div>
  );
}
