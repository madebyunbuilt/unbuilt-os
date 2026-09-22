'use client';

import { Download } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CodeInput } from '@/components/auth/code-input';
import { DocumentBlocks } from '@/components/documents/document-blocks';
import { SignaturePad } from '@/components/signing/signature-pad';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { signing, type SigningPage, uploadSignature } from '@/lib/signing-client';

// Signing a document from an emailed link (07-documents-and-esign.md, The signing ceremony): read it in full, confirm
// the email address with a code, then type or draw a signature, agree to the consent statement and sign. Declining
// needs the same code and a reason. The server decides everything; this only walks the signer through it.

const longDate = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Africa/Lagos' });

type Stage = 'read' | 'code' | 'sign' | 'decline' | 'signed' | 'declined';

export function SigningCeremony({ token }: { token: string }) {
  const [page, setPage] = useState<SigningPage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('read');

  const load = useCallback(async () => {
    const answer = await signing.view(token);
    if (!answer.ok) {
      setLoadError(answer.message);
      return;
    }
    setLoadError(null);
    setPage(answer.page);
  }, [token]);

  useEffect(() => {
    // Fetched once when the link is opened; the server records the look.
    let cancelled = false;
    void signing.view(token).then((answer) => {
      if (cancelled) return;
      if (answer.ok) setPage(answer.page);
      else setLoadError(answer.message);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loadError) {
    return (
      <Notice title="This signing link does not work">
        {loadError} If you expected to sign something, ask the person who sent it for a new link.
      </Notice>
    );
  }
  if (!page) return <p className="text-muted-foreground">Opening the document…</p>;

  const heading = `${page.typeLabel}${page.number ? ` ${page.number}` : ''}: ${page.title}`;

  if (stage === 'signed') {
    return (
      <Notice title="Thank you, you have signed">
        {heading}. Once everyone has signed, we will email you a copy of the signed document with its certificate.
      </Notice>
    );
  }
  if (stage === 'declined') {
    return (
      <Notice title="You declined to sign">
        {page.studioName} has been told, with your reason. Nothing else is needed from you.
      </Notice>
    );
  }
  if (!page.document) return <ClosedNotice page={page} heading={heading} />;

  const document = page.document;
  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {page.studioName} has asked {page.signer.name} to sign
        </p>
        <h1 className="font-display text-3xl font-bold">{heading}</h1>
        <p className="text-sm text-muted-foreground">
          Read it in full before you sign. This link works until {longDate.format(page.request.expiresAt)}.
        </p>
        {document.pdfUrl && (
          <Button variant="outline" asChild>
            <a href={document.pdfUrl} rel="noreferrer">
              <Download aria-hidden />
              Download the PDF
            </a>
          </Button>
        )}
      </header>

      <DocumentBlocks
        blocks={document.blocks}
        lineItems={document.lineItems}
        totals={document.totals}
        currency={document.currency}
      />

      <section aria-labelledby="signing-steps" className="space-y-4 rounded-lg border p-6">
        <h2 id="signing-steps" className="font-display text-xl font-bold">
          {stage === 'decline' ? 'Decline to sign' : 'Sign this document'}
        </h2>
        {stage === 'read' && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setStage(page.signer.codeVerified ? 'sign' : 'code')}>I have read it, sign</Button>
            <Button
              variant="ghost"
              onClick={() => setStage(page.signer.codeVerified ? 'decline' : 'code')}
              data-intent="decline"
            >
              Decline to sign
            </Button>
          </div>
        )}
        {stage === 'code' && (
          <CodeStep
            token={token}
            email={page.signer.email}
            onVerified={() => {
              setPage({ ...page, signer: { ...page.signer, codeVerified: true } });
              setStage('sign');
            }}
            onLocked={() => void load()}
          />
        )}
        {stage === 'sign' && page.consent && (
          <SignStep
            token={token}
            signerName={page.signer.name}
            consent={page.consent.text}
            onSigned={() => setStage('signed')}
            onDecline={() => setStage('decline')}
            onCodeNeeded={() => setStage('code')}
          />
        )}
        {stage === 'decline' && (
          <DeclineStep
            token={token}
            onDeclined={() => setStage('declined')}
            onBack={() => setStage('sign')}
            onCodeNeeded={() => setStage('code')}
          />
        )}
      </section>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h1 className="font-display text-3xl font-bold">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

/** A link whose request has closed, or whose signer has finished or is not yet due. */
function ClosedNotice({ page, heading }: { page: SigningPage; heading: string }) {
  const { signer, request } = page;
  if (signer.status === 'signed') {
    return (
      <Notice title="You have signed this">
        {heading}.{' '}
        {request.status === 'completed'
          ? 'Everyone has signed, and a copy of the signed document has been emailed to you.'
          : 'We will email you a copy once everyone has signed.'}
      </Notice>
    );
  }
  if (signer.status === 'locked') {
    return (
      <Notice title="This link is locked">
        Too many wrong codes were entered. Ask {page.studioName} to send you a new link.
      </Notice>
    );
  }
  if (signer.status === 'declined') return <Notice title="You declined to sign this">{heading}.</Notice>;
  if (signer.status === 'waiting') {
    return <Notice title="It is not your turn yet">We will email you when it is ready for your signature.</Notice>;
  }
  const why =
    request.status === 'cancelled'
      ? `${page.studioName} has cancelled this signing request.`
      : request.status === 'declined'
        ? 'Someone declined to sign, so this request has closed.'
        : request.status === 'completed'
          ? 'Everyone has signed.'
          : 'This signing link has expired.';
  return (
    <Notice title="This document is no longer open for signing">
      {why} If you still need to sign it, ask {page.studioName} for a new link.
    </Notice>
  );
}

function CodeStep({
  token,
  email,
  onVerified,
  onLocked,
}: {
  token: string;
  email: string;
  onVerified: () => void;
  onLocked: () => void;
}) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    const answer = await signing.code(token);
    setBusy(false);
    if (answer.ok) setSentTo(answer.sentTo);
    else setError(answer.message);
  };

  const check = async (value: string) => {
    setBusy(true);
    setError(null);
    const answer = await signing.verify(token, value);
    setBusy(false);
    if (!answer.ok) {
      setError(answer.message);
      return;
    }
    if (answer.verified) {
      onVerified();
      return;
    }
    setCode('');
    if (answer.locked) {
      onLocked();
      return;
    }
    setError(
      `That code is not right. ${answer.attemptsLeft} ${answer.attemptsLeft === 1 ? 'try' : 'tries'} left before the link locks.`,
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm">
        First, confirm it is you. We will email a 6-digit code to the address this was sent to
        {sentTo ? `, ${sentTo}` : ` (${email.replace(/^(.)[^@]*(@.*)$/, '$1…$2')})`}. It works for 10 minutes.
      </p>
      {sentTo ? (
        <div className="space-y-2">
          <Label htmlFor="signing-code">The code from the email</Label>
          <CodeInput
            id="signing-code"
            value={code}
            onChange={setCode}
            onComplete={(value) => void check(value)}
            disabled={busy}
            describedBy={error ? 'signing-code-error' : undefined}
          />
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void send()}>
            Send a new code
          </Button>
        </div>
      ) : (
        <Button onClick={() => void send()} disabled={busy}>
          {busy ? 'Sending…' : 'Email me a code'}
        </Button>
      )}
      {error && (
        <p id="signing-code-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function SignStep({
  token,
  signerName,
  consent,
  onSigned,
  onDecline,
  onCodeNeeded,
}: {
  token: string;
  signerName: string;
  consent: string;
  onSigned: () => void;
  onDecline: () => void;
  onCodeNeeded: () => void;
}) {
  const [method, setMethod] = useState<'typed' | 'drawn'>('typed');
  const [typedName, setTypedName] = useState(signerName);
  const [image, setImage] = useState<Blob | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ready = agreed && (method === 'typed' ? typedName.trim().length > 0 : image !== null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    let imageStorageId: string | undefined;
    if (method === 'drawn' && image) {
      const upload = await signing.upload(token);
      if (!upload.ok) {
        setBusy(false);
        if (upload.code === 'signatures.codeNeeded') onCodeNeeded();
        else setError(upload.message);
        return;
      }
      imageStorageId = (await uploadSignature(upload.uploadUrl, image)) ?? undefined;
      if (!imageStorageId) {
        setBusy(false);
        setError('Your drawing could not be saved. Try again.');
        return;
      }
    }
    const answer = await signing.sign(token, {
      method,
      typedName: method === 'typed' ? typedName : undefined,
      imageStorageId,
      consent: agreed,
    });
    setBusy(false);
    if (answer.ok) onSigned();
    else if (answer.code === 'signatures.codeNeeded') onCodeNeeded();
    else setError(answer.message);
  };

  return (
    <form
      className="space-y-5"
      aria-label="Your signature"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) void submit();
      }}
    >
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">How would you like to sign?</legend>
        <div className="flex gap-2" role="radiogroup" aria-label="How would you like to sign?">
          {(['typed', 'drawn'] as const).map((option) => (
            <Button
              key={option}
              type="button"
              role="radio"
              aria-checked={method === option}
              variant={method === option ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMethod(option)}
            >
              {option === 'typed' ? 'Type my name' : 'Draw it'}
            </Button>
          ))}
        </div>
      </fieldset>

      {method === 'typed' ? (
        <div className="space-y-2">
          <Label htmlFor="signing-name">Your full name</Label>
          <Input
            id="signing-name"
            value={typedName}
            autoComplete="name"
            onChange={(event) => setTypedName(event.target.value)}
          />
          {typedName.trim() && (
            <p className="font-signature text-3xl" aria-label={`Your signature will read ${typedName}`}>
              {typedName}
            </p>
          )}
        </div>
      ) : (
        <SignaturePad onChange={setImage} />
      )}

      <div className="flex items-start gap-3 rounded-md border p-3">
        <Checkbox id="signing-consent" checked={agreed} onCheckedChange={(value) => setAgreed(value === true)} />
        <Label htmlFor="signing-consent" className="font-normal leading-relaxed">
          {consent}
        </Label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!ready || busy}>
          {busy ? 'Signing…' : 'Sign'}
        </Button>
        <Button type="button" variant="ghost" onClick={onDecline}>
          Decline to sign
        </Button>
      </div>
    </form>
  );
}

function DeclineStep({
  token,
  onDeclined,
  onBack,
  onCodeNeeded,
}: {
  token: string;
  onDeclined: () => void;
  onBack: () => void;
  onCodeNeeded: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="space-y-4"
      aria-label="Decline to sign"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const answer = await signing.decline(token, reason);
        setBusy(false);
        if (answer.ok) onDeclined();
        else if (answer.code === 'signatures.codeNeeded') onCodeNeeded();
        else setError(answer.message);
      }}
    >
      <p className="text-sm">
        Declining closes this request for everyone. The studio is told, with your reason, and can send a new version.
      </p>
      <div className="space-y-2">
        <Label htmlFor="decline-reason">Why are you declining?</Label>
        <Textarea id="decline-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={!reason.trim() || busy}>
          {busy ? 'Declining…' : 'Decline to sign'}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack}>
          Back to signing
        </Button>
      </div>
    </form>
  );
}
