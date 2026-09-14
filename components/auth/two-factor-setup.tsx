'use client';

import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { CodeInput } from '@/components/auth/code-input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

type Step =
  | { kind: 'loading' }
  | { kind: 'failed'; message: string }
  | { kind: 'scan'; qrDataUrl: string; secret: string; backupCodes: string[] }
  | { kind: 'backupCodes'; backupCodes: string[] };

/** Groups the base32 key in fours so it can be typed into an authenticator by hand. */
export function formatSecret(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get('secret') ?? '';
  return secret.match(/.{1,4}/g)?.join(' ') ?? secret;
}

export function TwoFactorSetup({ email }: { email: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    // Enabling generates a new secret, so do it once per visit.
    if (started.current) return;
    started.current = true;
    void (async () => {
      const { data, error: enableError } = await authClient.twoFactor.enable({} as { password: string });
      if (enableError || !data) {
        setStep({ kind: 'failed', message: 'We could not start two-factor setup. Reload the page to try again.' });
        return;
      }
      setStep({
        kind: 'scan',
        qrDataUrl: await QRCode.toDataURL(data.totpURI, { margin: 1, width: 220 }),
        secret: formatSecret(data.totpURI),
        backupCodes: data.backupCodes,
      });
    })();
  }, []);

  async function confirm(value: string) {
    if (step.kind !== 'scan' || pending) return;
    setPending(true);
    setError(null);
    const { error: verifyError } = await authClient.twoFactor.verifyTotp({ code: value });
    setPending(false);
    if (verifyError) {
      setCode('');
      setError('That code did not match. Wait for the next code in your app and try again.');
      return;
    }
    setStep({ kind: 'backupCodes', backupCodes: step.backupCodes });
  }

  if (step.kind === 'loading') {
    return <p aria-live="polite">Preparing your authenticator setup…</p>;
  }

  if (step.kind === 'failed') {
    return (
      <p role="alert" className="text-destructive">
        {step.message}
      </p>
    );
  }

  if (step.kind === 'backupCodes') {
    return (
      <section aria-labelledby="backup-heading">
        <h1 id="backup-heading" className="font-display text-2xl font-bold">
          Save your backup codes
        </h1>
        <p className="mt-2 text-muted-foreground">
          If you lose your phone, each code signs you in once. Store them somewhere safe; you will not see them again.
        </p>
        <ul className="mt-6 grid grid-cols-2 gap-2 rounded-lg border p-4 font-mono text-sm" aria-label="Backup codes">
          {step.backupCodes.map((backupCode) => (
            <li key={backupCode}>{backupCode}</li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col gap-3">
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(step.backupCodes.join('\n'));
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy codes'}
          </Button>
          <Button
            onClick={() => {
              router.replace('/');
              router.refresh();
            }}
          >
            I have saved them
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="setup-heading">
      <h1 id="setup-heading" className="font-display text-2xl font-bold">
        Set up two-factor authentication
      </h1>
      <p className="mt-2 text-muted-foreground">
        Every studio account uses an authenticator app. Scan this code with Google Authenticator, 1Password, Authy or a
        similar app.
      </p>

      {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing to optimise */}
      <img
        src={step.qrDataUrl}
        alt={`QR code for adding ${email} to an authenticator app`}
        width={220}
        height={220}
        className="mt-6 rounded-md border bg-white p-2"
      />

      <details className="mt-4 text-sm">
        <summary className="cursor-pointer underline underline-offset-4">Can’t scan? Enter the key instead</summary>
        <p className="mt-2 font-mono tracking-wide break-all" aria-label="Setup key">
          {step.secret}
        </p>
      </details>

      <form
        className="mt-8 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void confirm(code);
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="setup-code">Enter the 6-digit code from the app</Label>
          <CodeInput
            id="setup-code"
            value={code}
            onChange={setCode}
            onComplete={(value) => void confirm(value)}
            disabled={pending}
            describedBy={error ? 'setup-error' : undefined}
          />
        </div>
        <div aria-live="polite">
          {error && (
            <p id="setup-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full" disabled={pending || code.length !== 6}>
          {pending ? 'Checking…' : 'Turn on two-factor authentication'}
        </Button>
      </form>
    </section>
  );
}
