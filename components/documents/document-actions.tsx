'use client';

import { useMutation, useQuery } from 'convex/react';
import { Download, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
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
import { errorMessage } from '@/lib/convex-error';

// Sending a document, recording what the client said, voiding it, and fetching the PDF. Each of these is the one action
// its permission allows, so the page only shows what this person can actually do.

type Document = NonNullable<typeof api.documents.get._returnType>;

/** Sending: the primary contact is ticked, others can be added, and a note can go with it. */
export function SendDialog({ document, onSent }: { document: Document; onSent?: () => void }) {
  const send = useMutation(api.documents.send);
  const contacts = useQuery(api.contacts.listForClient, { clientId: document.clientId });
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [message, setMessage] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const active = (contacts ?? []).filter((contact) => contact.status === 'active');
  const selected = chosen ?? active.filter((contact) => contact.isPrimary).map((contact) => contact.id);
  const resend = document.currentVersion > 0;

  return (
    <>
      {/* The page lists what is missing; the server refuses the send anyway. */}
      <Button onClick={() => setOpen(true)} disabled={document.missing.length > 0}>
        <Send aria-hidden />
        {resend ? 'Send the next version' : 'Send to the client'}
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
            <DialogTitle className="font-display">
              {resend ? `Send version ${document.currentVersion + 1}` : 'Send this document'}
            </DialogTitle>
            <DialogDescription>
              {resend
                ? 'The client is emailed the new version. The one they have keeps its place in the history.'
                : 'The client is emailed a link to read it in their portal. It is numbered as it goes out.'}
            </DialogDescription>
          </DialogHeader>
          <form
            id="send-document"
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (selected.length === 0) {
                setError('Choose at least one person to send it to');
                return;
              }
              setSaving(true);
              setError(null);
              try {
                await send({
                  documentId: document.id,
                  contactIds: selected as Id<'contacts'>[],
                  message: message || undefined,
                  changeNote: changeNote || undefined,
                });
                setOpen(false);
                setMessage('');
                setChangeNote('');
                onSent?.();
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setSaving(false);
              }
            }}
          >
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Who it goes to</legend>
              {active.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This client has no active contact with an email address yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {active.map((contact) => (
                    <li key={contact.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`send-to-${contact.id}`}
                        checked={selected.includes(contact.id)}
                        onCheckedChange={(checked) =>
                          setChosen(
                            checked === true ? [...selected, contact.id] : selected.filter((id) => id !== contact.id),
                          )
                        }
                      />
                      <Label htmlFor={`send-to-${contact.id}`} className="font-normal">
                        {contact.name} · {contact.email}
                        {contact.isPrimary && <span className="text-muted-foreground"> · main contact</span>}
                      </Label>
                    </li>
                  ))}
                </ul>
              )}
            </fieldset>
            <div className="space-y-2">
              <Label htmlFor="send-message">A note with it (optional)</Label>
              <Textarea
                id="send-message"
                rows={3}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </div>
            {resend && (
              <div className="space-y-2">
                <Label htmlFor="send-change-note">What changed (optional)</Label>
                <Input
                  id="send-change-note"
                  value={changeNote}
                  onChange={(event) => setChangeNote(event.target.value)}
                />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button type="submit" form="send-document" disabled={saving}>
              {saving ? 'Sending…' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** What the client said, when they said it somewhere other than the portal. */
export function DecisionDialog({ document }: { document: Document }) {
  const record = useMutation(api.documents.recordDecision);
  const contacts = useQuery(api.contacts.listForClient, { clientId: document.clientId });
  const [decision, setDecision] = useState<'accepted' | 'declined' | null>(null);
  const [contactId, setContactId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setDecision('accepted')}>
        Record acceptance
      </Button>
      <Button variant="ghost" onClick={() => setDecision('declined')}>
        Record a decline
      </Button>
      <Dialog
        open={decision !== null}
        onOpenChange={(next) => {
          if (!next) setDecision(null);
          setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">
              {decision === 'declined' ? 'Record a decline' : 'Record acceptance'}
            </DialogTitle>
            <DialogDescription>
              For a decision the client gave you by email, on a call or in person. The document records that the studio
              entered it, and who.
            </DialogDescription>
          </DialogHeader>
          <form
            id="record-decision"
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!decision) return;
              setSaving(true);
              setError(null);
              try {
                await record({
                  documentId: document.id,
                  decision,
                  contactId: (contactId || undefined) as Id<'contacts'> | undefined,
                  note: note || undefined,
                });
                setDecision(null);
                setNote('');
              } catch (caught) {
                setError(errorMessage(caught));
              } finally {
                setSaving(false);
              }
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="decision-contact">Who said so (optional)</Label>
              <NativeSelect
                id="decision-contact"
                value={contactId}
                onChange={(event) => setContactId(event.target.value)}
              >
                <option value="">Not recorded</option>
                {(contacts ?? [])
                  .filter((contact) => contact.status === 'active')
                  .map((contact) => (
                    <option key={contact.id} value={contact.id}>
                      {contact.name}
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="decision-note">{decision === 'declined' ? 'Why they declined' : 'Note (optional)'}</Label>
              <Textarea id="decision-note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </form>
          <DialogFooter>
            <Button type="submit" form="record-decision" disabled={saving}>
              {saving ? 'Saving…' : decision === 'declined' ? 'Record the decline' : 'Record the acceptance'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function VoidDialog({ document }: { document: Document }) {
  const voidDocument = useMutation(api.documents.voidDocument);
  const [reason, setReason] = useState('');

  return (
    <ConfirmDialog
      trigger={<Button variant="ghost">Void</Button>}
      title={`Void ${document.number ?? 'this draft'}?`}
      description="It keeps its number and stays on record, watermarked void on the PDF. Nothing can be sent from it afterwards."
      confirmLabel="Void it"
      canConfirm={reason.trim().length > 0}
      onConfirm={() => voidDocument({ documentId: document.id, reason })}
    >
      <div className="space-y-2">
        <Label htmlFor="void-reason">Why</Label>
        <Textarea id="void-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
    </ConfirmDialog>
  );
}

/** Fetches a short-lived link only when asked, then starts the download. */
export function DownloadPdfButton({ fileId, label = 'Download the PDF' }: { fileId: Id<'files'>; label?: string }) {
  const [wanted, setWanted] = useState(false);
  const started = useRef(false);
  const link = useQuery(api.files.teamDownloadUrl, wanted ? { fileId } : 'skip');

  useEffect(() => {
    if (link && !started.current) {
      started.current = true;
      window.location.href = link.url;
    }
  }, [link]);

  return (
    <Button variant="outline" disabled={wanted} onClick={() => setWanted(true)}>
      <Download aria-hidden />
      {wanted && !link ? 'Preparing…' : label}
    </Button>
  );
}
