'use client';

import Link from 'next/link';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { CodeInput } from '@/components/auth/code-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

type AuthError = { status: number; code?: string; message?: string } | null;

const RESEND_COOLDOWN_SECONDS = 30;

/** Maps Better Auth's two-factor errors to what the person can do next. */
export function verifyErrorMessage(error: NonNullable<AuthError>): { message: string; restart: boolean } {
  if (error.code === 'INVALID_TWO_FACTOR_COOKIE' || error.code === 'OTP_HAS_EXPIRED') {
    return { message: 'This code has expired. Send a new one, or start again with a new sign-in link.', restart: true };
  }
  if (error.code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' || error.status === 429) {
    return {
      message: 'Too many attempts. Wait a few minutes, then start again with a new sign-in link.',
      restart: true,
    };
  }
  return { message: 'That code did not work. Check it and try again.', restart: false };
}

export function VerifyForm({ method, callbackURL }: { method: 'totp' | 'otp'; callbackURL: string }) {
  const [code, setCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [trustDevice, setTrustDevice] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; restart: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const sentOnce = useRef(false);

  const sendCode = useCallback(async () => {
    setError(null);
    const { error: sendError } = await authClient.twoFactor.sendOtp();
    if (sendError) {
      setError(verifyErrorMessage(sendError));
      return;
    }
    setNotice('We have emailed you a 6-digit code. It expires in 3 minutes.');
    setCooldown(RESEND_COOLDOWN_SECONDS);
  }, []);

  useEffect(() => {
    if (method !== 'otp' || sentOnce.current) return;
    sentOnce.current = true;
    void sendCode();
  }, [method, sendCode]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function verify(value: string) {
    if (pending) return;
    setPending(true);
    setError(null);
    const { error: verifyError } =
      method === 'otp'
        ? await authClient.twoFactor.verifyOtp({ code: value, trustDevice })
        : useBackupCode
          ? await authClient.twoFactor.verifyBackupCode({ code: value })
          : await authClient.twoFactor.verifyTotp({ code: value });
    if (verifyError) {
      setError(verifyErrorMessage(verifyError));
      setCode('');
      setPending(false);
      return;
    }
    // A full navigation, so the server sees the new session cookie.
    window.location.assign(callbackURL);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void verify(code.trim());
  }

  const heading = method === 'otp' ? 'Check your email for a code' : 'Enter your authenticator code';
  const intro =
    method === 'otp'
      ? 'For your security, we confirm new devices with a code sent to your email.'
      : useBackupCode
        ? 'Enter one of the backup codes you saved when you set up your authenticator. Each works once.'
        : 'Open your authenticator app and enter the 6-digit code for Unbuilt OS.';

  return (
    <section aria-labelledby="verify-heading">
      <h1 id="verify-heading" className="font-display text-2xl font-bold">
        {heading}
      </h1>
      <p className="mt-2 text-muted-foreground">{intro}</p>

      <form className="mt-8 space-y-5" onSubmit={onSubmit}>
        <div className="space-y-2">
          <Label htmlFor="code">{useBackupCode ? 'Backup code' : 'Code'}</Label>
          {useBackupCode ? (
            <Input
              id="code"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-describedby={error ? 'verify-error' : undefined}
            />
          ) : (
            <CodeInput
              id="code"
              value={code}
              onChange={setCode}
              onComplete={(value) => void verify(value)}
              disabled={pending}
              describedBy={error ? 'verify-error' : undefined}
            />
          )}
        </div>

        {method === 'otp' && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="trust-device"
              checked={trustDevice}
              onCheckedChange={(checked) => setTrustDevice(checked === true)}
            />
            <Label htmlFor="trust-device" className="font-normal">
              Trust this device for 30 days
            </Label>
          </div>
        )}

        <div aria-live="polite" className="space-y-2 text-sm">
          {notice && !error && <p className="text-muted-foreground">{notice}</p>}
          {error && (
            <p id="verify-error" role="alert" className="text-destructive">
              {error.message}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" disabled={pending || code.trim().length === 0}>
          {pending ? 'Checking…' : 'Continue'}
        </Button>
      </form>

      <div className="mt-6 flex flex-col items-start gap-3 text-sm">
        {method === 'otp' && (
          <Button variant="link" className="h-auto p-0" disabled={cooldown > 0} onClick={() => void sendCode()}>
            {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
          </Button>
        )}
        {method === 'totp' && (
          <Button
            variant="link"
            className="h-auto p-0"
            onClick={() => {
              setUseBackupCode((value) => !value);
              setCode('');
              setError(null);
            }}
          >
            {useBackupCode ? 'Use your authenticator app instead' : 'Lost your authenticator? Use a backup code'}
          </Button>
        )}
        {error?.restart && (
          <Link href="/sign-in" className="underline underline-offset-4">
            Start again with a new sign-in link
          </Link>
        )}
      </div>
    </section>
  );
}
