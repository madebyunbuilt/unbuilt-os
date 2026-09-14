'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';
import { type Surface } from '@/lib/surface';

type Status =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string };

export function SignInForm({
  surface,
  callbackURL,
  initialError,
}: {
  surface: Surface;
  callbackURL: string;
  initialError: string | null;
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>(
    initialError ? { kind: 'error', message: initialError } : { kind: 'idle' },
  );
  const sentHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (status.kind === 'sent') sentHeading.current?.focus();
  }, [status.kind]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    setStatus({ kind: 'sending' });
    const { error } = await authClient.signIn.magicLink({ email: address, callbackURL, errorCallbackURL: '/sign-in' });
    if (error) {
      setStatus({
        kind: 'error',
        message:
          error.status === 429
            ? 'Too many sign-in requests. Wait a minute and try again.'
            : 'We could not send a sign-in link just now. Try again.',
      });
      return;
    }
    setStatus({ kind: 'sent', email: address });
  }

  if (status.kind === 'sent') {
    return (
      <section aria-labelledby="sent-heading">
        <h1 id="sent-heading" ref={sentHeading} tabIndex={-1} className="font-display text-2xl font-bold">
          Check your email
        </h1>
        <p className="mt-3 text-muted-foreground">
          If <span className="font-medium text-foreground">{status.email}</span> has access, we have sent a sign-in
          link. It works once and expires in 15 minutes.
        </p>
        <Button variant="outline" className="mt-8 w-full" onClick={() => setStatus({ kind: 'idle' })}>
          Use a different email
        </Button>
      </section>
    );
  }

  return (
    <section aria-labelledby="sign-in-heading">
      <h1 id="sign-in-heading" className="font-display text-2xl font-bold">
        Sign in
      </h1>
      <p className="mt-2 text-muted-foreground">
        {surface === 'portal'
          ? 'Enter the email address the studio invited. We will email you a sign-in link.'
          : 'Enter your studio email address. We will email you a sign-in link.'}
      </p>

      <form className="mt-8 space-y-4" onSubmit={onSubmit} noValidate={false}>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={status.kind === 'error' ? 'sign-in-error' : undefined}
          />
        </div>
        <div aria-live="polite">
          {status.kind === 'error' && (
            <p id="sign-in-error" role="alert" className="text-sm text-destructive">
              {status.message}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={status.kind === 'sending'}>
          {status.kind === 'sending' ? 'Sending…' : 'Email me a sign-in link'}
        </Button>
      </form>
    </section>
  );
}
