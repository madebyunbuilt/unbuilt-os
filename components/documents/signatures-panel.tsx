'use client';

import { useMutation, useQuery } from 'convex/react';
import { PenLine, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { DownloadPdfButton } from '@/components/documents/document-actions';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { CONSENT_TEXT, DEFAULT_EXPIRY_DAYS } from '@/convex/lib/signatures';
import { errorMessage } from '@/lib/convex-error';
import { type StatusTone } from '@/lib/team-display';

// Signatures on the document page (07-documents-and-esign.md, E-signatures): set up a request, follow each signer,
// send a new link or cancel, countersign when it is your turn, and download and verify the signed PDF. Each action shows
// only to the permission that allows it; the server checks again.

type Document = NonNullable<typeof api.documents.get._returnType>;
type Request = NonNullable<typeof api.signatures.listForDocument._returnType>[number];
type Signer = Request['signers'][number];

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** Quotes and proposals are accepted, not signed. */
const ACCEPTED_TYPES = new Set(['quote', 'proposal']);
const REQUESTABLE = new Set(['sent', 'viewed', 'awaiting_signature']);

const SIGNER_STATUS: Record<Signer['status'], { label: string; tone: StatusTone }> = {
  waiting: { label: 'Waiting their turn', tone: 'muted' },
  invited: { label: 'Invited', tone: 'draft' },
  signed: { label: 'Signed', tone: 'built' },
  declined: { label: 'Declined', tone: 'attention' },
  locked: { label: 'Locked: too many wrong codes', tone: 'attention' },
};

const REQUEST_STATUS: Record<Request['status'], string> = {
  pending: 'In progress',
  completed: 'Signed by everyone',
  declined: 'Declined',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export function SignaturesPanel({ document, permissions }: { document: Document; permissions: string[] }) {
  const requests = useQuery(api.signatures.listForDocument, { documentId: document.id });
  if (ACCEPTED_TYPES.has(document.type) || document.currentVersion === 0) return null;
  if (requests === undefined) return null;

  const [current, ...earlier] = requests;
  const open = current?.status === 'pending';
  const canRequest =
    permissions.includes('documents.send') && REQUESTABLE.has(document.status) && !open && !document.signingOpen;

  return (
    <section aria-labelledby="signatures-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="signatures-heading" className="font-display text-xl font-bold">
          Signatures
        </h2>
        {canRequest && <RequestDialog document={document} />}
      </div>
      {!current && (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          Nobody has been asked to sign this yet.
        </p>
      )}
      {current && <RequestCard request={current} permissions={permissions} />}
      {earlier.length > 0 && (
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Earlier requests ({earlier.length})</summary>
          <ul className="mt-2 space-y-1 text-muted-foreground">
            {earlier.map((request) => (
              <li key={request.id}>
                {dateTime.format(request.createdAt)}: {REQUEST_STATUS[request.status]}, version{' '}
                {request.documentVersion}
                {request.signers.find((signer) => signer.declineReason)?.declineReason &&
                  ` (“${request.signers.find((signer) => signer.declineReason)?.declineReason}”)`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function RequestCard({ request, permissions }: { request: Request; permissions: string[] }) {
  const canSend = permissions.includes('documents.send');
  const pending = request.status === 'pending';
  return (
    <div className="space-y-4 rounded-lg border p-5">
      <div className="flex flex-wrap items-center gap-3">
        <ToneBadge
          label={REQUEST_STATUS[request.status]}
          tone={request.status === 'completed' ? 'built' : pending ? 'draft' : 'muted'}
        />
        <p className="text-sm text-muted-foreground">
          Version {request.documentVersion} · {request.order === 'sequential' ? 'one after another' : 'all at once'}
          {pending && ` · open until ${dateTime.format(request.expiresAt)}`}
          {request.completedAt !== undefined && ` · completed ${dateTime.format(request.completedAt)}`}
        </p>
      </div>

      <ul className="divide-y rounded-md border">
        {request.signers.map((signer) => (
          <li key={signer.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0">
              <p className="font-medium">
                {signer.name}
                {signer.kind === 'team_member' && <span className="text-muted-foreground"> · countersigns</span>}
              </p>
              <p className="text-sm text-muted-foreground">
                {signer.email}
                {signer.signedAt !== undefined && ` · signed ${dateTime.format(signer.signedAt)}`}
                {signer.signedAt === undefined &&
                  signer.viewedAt !== undefined &&
                  ` · opened ${dateTime.format(signer.viewedAt)}`}
              </p>
              {signer.declineReason && <p className="text-sm">Reason: {signer.declineReason}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
              <ToneBadge {...SIGNER_STATUS[signer.status]} />
              {pending &&
                canSend &&
                signer.kind === 'client_contact' &&
                (signer.status === 'invited' || signer.status === 'locked') && (
                  <ResendButton requestId={request.id} signer={signer} />
                )}
              {pending &&
                signer.isViewer &&
                signer.status === 'invited' &&
                permissions.includes('documents.countersign') && <CountersignDialog requestId={request.id} />}
            </div>
          </li>
        ))}
      </ul>

      {request.completionError && (
        <div role="alert" className="space-y-2 rounded-md bg-attention p-3 text-sm text-attention-foreground">
          <p>{request.completionError}</p>
          {canSend && !request.finalPdfFileId && <RetryButton requestId={request.id} />}
        </div>
      )}

      {request.status === 'completed' && request.finalPdfFileId && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <DownloadPdfButton fileId={request.finalPdfFileId} label="Download the signed PDF" />
            <VerifyButton requestId={request.id} lastCheckedAt={request.lastVerification?.checkedAt} />
          </div>
          <p className="text-xs break-all text-muted-foreground">Fingerprint (SHA-256): {request.finalPdfSha256}</p>
          {request.lastVerification && (
            <p
              role="status"
              className={
                request.lastVerification.ok
                  ? 'text-sm'
                  : 'rounded-md bg-attention p-2 text-sm text-attention-foreground'
              }
            >
              {request.lastVerification.ok
                ? `Verified ${dateTime.format(request.lastVerification.checkedAt)}: the stored files are unchanged.`
                : `Checked ${dateTime.format(request.lastVerification.checkedAt)}: a stored file no longer matches its fingerprint.`}
            </p>
          )}
        </div>
      )}

      {pending && canSend && <CancelDialog requestId={request.id} />}
    </div>
  );
}

function RequestDialog({ document }: { document: Document }) {
  const createRequest = useMutation(api.signatures.createRequest);
  const contacts = useQuery(api.contacts.listForClient, { clientId: document.clientId });
  const countersigners = useQuery(api.signatures.countersigners, {});
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [countersigner, setCountersigner] = useState('');
  const [order, setOrder] = useState<'sequential' | 'parallel'>('sequential');
  const [days, setDays] = useState(String(DEFAULT_EXPIRY_DAYS));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const active = (contacts ?? []).filter((contact) => contact.status === 'active');
  const selected = chosen ?? active.filter((contact) => contact.isPrimary).map((contact) => contact.id);

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={document.missing.length > 0}>
        <PenLine aria-hidden />
        Send for signature
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Send for signature</DialogTitle>
            <DialogDescription>
              Each person gets their own link and confirms their email with a code before signing. Version{' '}
              {document.currentVersion} is locked for signing.
            </DialogDescription>
          </DialogHeader>
          <form
            id="request-signatures"
            className="space-y-5"
            onSubmit={async (event) => {
              event.preventDefault();
              if (selected.length === 0) {
                setError('Choose at least one person at the client to sign');
                return;
              }
              setSaving(true);
              setError(null);
              try {
                await createRequest({
                  documentId: document.id,
                  contactIds: selected as Id<'contacts'>[],
                  countersignerMemberId: countersigner ? (countersigner as Id<'teamMembers'>) : undefined,
                  order,
                  expiresInDays: Number(days),
                });
                setOpen(false);
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setSaving(false);
              }
            }}
          >
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Who signs for the client</legend>
              {active.length === 0 && (
                <p className="text-sm text-muted-foreground">This client has no active contacts to sign.</p>
              )}
              {active.map((contact) => (
                <div key={contact.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`signer-${contact.id}`}
                    checked={selected.includes(contact.id)}
                    onCheckedChange={(value) =>
                      setChosen(value === true ? [...selected, contact.id] : selected.filter((id) => id !== contact.id))
                    }
                  />
                  <Label htmlFor={`signer-${contact.id}`} className="font-normal">
                    {contact.name} <span className="text-muted-foreground">· {contact.email}</span>
                  </Label>
                </div>
              ))}
            </fieldset>

            <div className="space-y-2">
              <Label htmlFor="countersigner">Countersigned by the studio</Label>
              <NativeSelect
                id="countersigner"
                value={countersigner}
                onChange={(event) => setCountersigner(event.target.value)}
              >
                <option value="">Nobody</option>
                {(countersigners ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-sm text-muted-foreground">The studio signs last, inside the app.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="signing-order">Order</Label>
                <NativeSelect
                  id="signing-order"
                  value={order}
                  onChange={(event) => setOrder(event.target.value as 'sequential' | 'parallel')}
                >
                  <option value="sequential">One after another</option>
                  <option value="parallel">Everyone at once</option>
                </NativeSelect>
              </div>
              <div className="space-y-2">
                <Label htmlFor="signing-days">Open for (days)</Label>
                <Input
                  id="signing-days"
                  type="number"
                  min={1}
                  max={90}
                  value={days}
                  onChange={(event) => setDays(event.target.value)}
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button type="submit" form="request-signatures" disabled={saving}>
              {saving ? 'Sending…' : 'Send the links'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ResendButton({ requestId, signer }: { requestId: Id<'signatureRequests'>; signer: Signer }) {
  const resend = useMutation(api.signatures.resendLink);
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          {signer.status === 'locked' ? 'Unlock with a new link' : 'Send a new link'}
        </Button>
      }
      title={`Send ${signer.name} a new link?`}
      description="Their earlier link stops working. The new one arrives by email, and they confirm it is them with a fresh code."
      confirmLabel="Send it"
      onConfirm={() => resend({ requestId, signerId: signer.id })}
    />
  );
}

function CancelDialog({ requestId }: { requestId: Id<'signatureRequests'> }) {
  const cancel = useMutation(api.signatures.cancelRequest);
  const [reason, setReason] = useState('');
  return (
    <ConfirmDialog
      trigger={<Button variant="ghost">Cancel the request</Button>}
      title="Cancel this signing request?"
      description="Every link stops working. Signatures already given stay on record but no longer count. You can send a new version or a new request afterwards."
      confirmLabel="Cancel it"
      canConfirm={reason.trim().length > 0}
      onConfirm={() => cancel({ requestId, reason })}
    >
      <div className="space-y-2">
        <Label htmlFor="cancel-reason">Why</Label>
        <Textarea id="cancel-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
    </ConfirmDialog>
  );
}

function CountersignDialog({ requestId }: { requestId: Id<'signatureRequests'> }) {
  const countersign = useMutation(api.signatures.countersign);
  const me = useQuery(api.team.me, {});
  const [typedName, setTypedName] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const name = typedName ?? me?.name ?? '';
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm">
          <PenLine aria-hidden />
          Countersign
        </Button>
      }
      title="Countersign for the studio"
      description="Your two-factor sign-in confirms it is you. Your signature is recorded with the time and this device."
      confirmLabel="Sign"
      canConfirm={agreed && name.trim().length > 0}
      onConfirm={() => countersign({ requestId, typedName: name, consent: agreed })}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="countersign-name">Your full name</Label>
          <Input id="countersign-name" value={name} onChange={(event) => setTypedName(event.target.value)} />
        </div>
        <div className="flex items-start gap-3">
          <Checkbox id="countersign-consent" checked={agreed} onCheckedChange={(value) => setAgreed(value === true)} />
          <Label htmlFor="countersign-consent" className="font-normal leading-relaxed">
            {CONSENT_TEXT}
          </Label>
        </div>
      </div>
    </ConfirmDialog>
  );
}

function VerifyButton({ requestId, lastCheckedAt }: { requestId: Id<'signatureRequests'>; lastCheckedAt?: number }) {
  const verify = useMutation(api.signatures.verify);
  const [error, setError] = useState<string | null>(null);
  // The check runs in the background; it is done when a result newer than the one on screen arrives.
  const [askedAfter, setAskedAfter] = useState<number | null>(null);
  const checking = askedAfter !== null && (lastCheckedAt ?? 0) === askedAfter;
  return (
    <>
      <Button
        variant="outline"
        disabled={checking}
        onClick={async () => {
          setError(null);
          try {
            await verify({ requestId });
            setAskedAfter(lastCheckedAt ?? 0);
          } catch (caught) {
            setError(errorMessage(caught));
          }
        }}
      >
        <ShieldCheck aria-hidden />
        {checking ? 'Checking…' : 'Verify'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}

function RetryButton({ requestId }: { requestId: Id<'signatureRequests'> }) {
  const retry = useMutation(api.signatures.retryCompletion);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await retry({ requestId });
        } finally {
          setBusy(false);
        }
      }}
    >
      Try again
    </Button>
  );
}
