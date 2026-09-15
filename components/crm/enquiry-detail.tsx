'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { ToneBadge } from '@/components/team/status-badge';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney, parseMoneyInput } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';
import { ENQUIRY_SOURCE_LABELS, enquiryStatus } from '@/lib/crm-display';

type Enquiry = NonNullable<typeof api.enquiries.get._returnType>;

const MATCH_REASONS = {
  email: 'A contact already uses this email',
  domain: 'Same company email domain',
  company: 'Same company name',
} as const;

const dateTime = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function EnquiryDetail({ enquiryId, permissions }: { enquiryId: Id<'enquiries'>; permissions: string[] }) {
  const enquiry = useQuery(api.enquiries.get, { enquiryId });
  const markReviewed = useMutation(api.enquiries.markReviewed);
  const canManage = permissions.includes('enquiries.manage');
  const status = enquiry?.status;

  // Opening a new enquiry marks it reviewed for everyone who works the inbox.
  useEffect(() => {
    if (canManage && status === 'new') void markReviewed({ enquiryId }).catch(() => {});
  }, [canManage, status, enquiryId, markReviewed]);

  if (enquiry === undefined) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-8">
      <Link
        href="/crm/enquiries"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Enquiries
      </Link>

      <header className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-display text-3xl font-bold">{enquiry.name}</h1>
            <ToneBadge {...enquiryStatus(enquiry.status)} />
          </div>
          <p className="mt-1 text-muted-foreground">{[enquiry.company, enquiry.email].filter(Boolean).join(' · ')}</p>
          <p className="text-sm text-muted-foreground">
            {ENQUIRY_SOURCE_LABELS[enquiry.source]} · {dateTime.format(enquiry.receivedAt)}
            {enquiry.decidedByName && enquiry.status !== 'new'
              ? ` · ${enquiryStatus(enquiry.status).label} by ${enquiry.decidedByName}`
              : ''}
          </p>
        </div>
        {canManage && <EnquiryActions enquiry={enquiry} permissions={permissions} />}
      </header>

      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="enquiry-answers-heading" className="min-w-0 space-y-4">
          <h2 id="enquiry-answers-heading" className="font-display text-xl font-bold">
            What they asked for
          </h2>
          <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-[10rem_1fr]">
            <dt className="text-sm text-muted-foreground">Services</dt>
            <dd>{enquiry.services.map((service) => service.label).join(', ') || '—'}</dd>
            <dt className="text-sm text-muted-foreground">Where it is now</dt>
            <dd>{enquiry.stage ?? '—'}</dd>
            <dt className="text-sm text-muted-foreground">Budget</dt>
            <dd>{enquiry.budget ?? '—'}</dd>
            <dt className="text-sm text-muted-foreground">When to start</dt>
            <dd>{enquiry.timeline ?? '—'}</dd>
            <dt className="text-sm text-muted-foreground">About the project</dt>
            <dd className="whitespace-pre-wrap">{enquiry.about ?? '—'}</dd>
            {'ip' in enquiry && (
              <>
                <dt className="text-sm text-muted-foreground">Sent from</dt>
                <dd className="text-sm break-all text-muted-foreground">
                  {[enquiry.ip, enquiry.userAgent].filter(Boolean).join(' · ') || '—'}
                </dd>
              </>
            )}
          </dl>
        </section>

        <aside className="space-y-6">
          {enquiry.status === 'converted' && (
            <section aria-labelledby="converted-heading" className="space-y-2 rounded-lg border p-4">
              <h2 id="converted-heading" className="font-display text-lg font-bold">
                Converted
              </h2>
              <p className="flex flex-wrap gap-3 text-sm">
                {enquiry.clientId && permissions.includes('clients.view') && (
                  <Link href={`/crm/clients/${enquiry.clientId}`} className="underline underline-offset-4">
                    Open the client
                  </Link>
                )}
                {enquiry.dealId && permissions.includes('deals.view') && (
                  <Link href={`/crm/deals/${enquiry.dealId}`} className="underline underline-offset-4">
                    Open the deal
                  </Link>
                )}
              </p>
            </section>
          )}
          {enquiry.existing.length > 0 && (
            <section aria-labelledby="existing-heading" className="space-y-3 rounded-lg border p-4">
              <h2 id="existing-heading" className="font-display text-lg font-bold">
                Already a contact
              </h2>
              <ul className="space-y-3 text-sm">
                {enquiry.existing.map((match) => (
                  <li key={match.contactId} className="space-y-1">
                    <p>
                      {match.contactName}
                      {match.contactStatus === 'left' ? ' (left)' : ''} at{' '}
                      <Link
                        href={`/crm/clients/${match.clientId}`}
                        className="font-medium underline underline-offset-4"
                      >
                        {match.clientName}
                      </Link>
                    </p>
                    {match.openDeals.length > 0 && (
                      <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                        {match.openDeals.map((deal) => (
                          <li key={deal.id}>
                            <Link href={`/crm/deals/${deal.id}`} className="underline underline-offset-4">
                              {deal.title}
                            </Link>{' '}
                            · {formatMoney(deal.valueMinor, deal.currency)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function EnquiryActions({ enquiry, permissions }: { enquiry: Enquiry; permissions: string[] }) {
  const markSpam = useMutation(api.enquiries.markSpam);
  const close = useMutation(api.enquiries.close);
  const reopen = useMutation(api.enquiries.reopen);
  const open = enquiry.status === 'new' || enquiry.status === 'reviewed';

  return (
    <div className="flex flex-wrap gap-2 sm:ml-auto">
      {open && permissions.includes('deals.manage') && <ConvertDialog enquiry={enquiry} permissions={permissions} />}
      {open && (
        <>
          <ConfirmDialog
            trigger={<Button variant="outline">Close</Button>}
            title="Close this enquiry?"
            description="For an enquiry you will not take on. It moves to Closed and can be reopened."
            confirmLabel="Close"
            onConfirm={() => close({ enquiryId: enquiry.id })}
          />
          <Button variant="ghost" onClick={() => void markSpam({ enquiryId: enquiry.id })}>
            Mark as spam
          </Button>
        </>
      )}
      {(enquiry.status === 'spam' || enquiry.status === 'closed') && (
        <Button variant="outline" onClick={() => void reopen({ enquiryId: enquiry.id })}>
          Reopen
        </Button>
      )}
    </div>
  );
}

function ConvertDialog({ enquiry, permissions }: { enquiry: Enquiry; permissions: string[] }) {
  const router = useRouter();
  const convert = useMutation(api.enquiries.convert);
  const [open, setOpen] = useState(false);
  const clients = useQuery(api.clients.list, open ? {} : 'skip');
  const canCreateClient = permissions.includes('clients.create');
  const suggested = enquiry.suggestedClient;
  const initialChoice = suggested ? suggested.clientId : canCreateClient ? 'new' : '';
  const [choice, setChoice] = useState<string>(initialChoice);
  const [newName, setNewName] = useState(enquiry.company ?? enquiry.name);
  const [kind, setKind] = useState<'company' | 'individual'>(enquiry.company ? 'company' : 'individual');
  const [title, setTitle] = useState(
    `${enquiry.services.map((service) => service.label).join(', ') || 'Project'} for ${enquiry.company ?? enquiry.name}`,
  );
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<Currency>('NGN');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (!choice) throw new Error('Choose a client');
      const result = await convert({
        enquiryId: enquiry.id,
        client:
          choice === 'new'
            ? { kind: 'new', displayName: newName, clientKind: kind }
            : { kind: 'existing', clientId: choice as Id<'clients'> },
        deal: { title, valueMinor: amount.trim() ? parseMoneyInput(amount, currency) : 0, currency },
      });
      setOpen(false);
      router.push(`/crm/deals/${result.dealId}`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>Convert</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Convert {enquiry.name}’s enquiry</DialogTitle>
          <DialogDescription>
            Creates a deal in the first stage, and the client and contact if they do not exist yet.
          </DialogDescription>
        </DialogHeader>
        <form
          id="convert-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {suggested && (
            <p className="rounded-md bg-muted p-3 text-sm">
              Suggested client: <span className="font-medium">{suggested.clientName}</span>.{' '}
              {MATCH_REASONS[suggested.reason]}.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="convert-client">Client</Label>
            <NativeSelect id="convert-client" value={choice} onChange={(event) => setChoice(event.target.value)}>
              {!canCreateClient && !suggested && <option value="">Choose a client</option>}
              {canCreateClient && <option value="new">A new client</option>}
              {suggested && !clients && <option value={suggested.clientId}>{suggested.clientName}</option>}
              {clients?.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.displayName}
                </option>
              ))}
            </NativeSelect>
          </div>
          {choice === 'new' && (
            <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
              <div className="space-y-2">
                <Label htmlFor="convert-new-name">New client’s name</Label>
                <Input id="convert-new-name" value={newName} onChange={(event) => setNewName(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="convert-kind">Kind</Label>
                <NativeSelect
                  id="convert-kind"
                  value={kind}
                  onChange={(event) => setKind(event.target.value as 'company' | 'individual')}
                >
                  <option value="company">Company</option>
                  <option value="individual">Individual</option>
                </NativeSelect>
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="convert-title">Deal title</Label>
            <Input id="convert-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
            <div className="space-y-2">
              <Label htmlFor="convert-amount">Estimated value</Label>
              <Input
                id="convert-amount"
                inputMode="decimal"
                value={amount}
                placeholder={enquiry.budget ?? 'Optional'}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="convert-currency">Currency</Label>
              <NativeSelect
                id="convert-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value as Currency)}
              >
                <option value="NGN">NGN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </NativeSelect>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form="convert-form" disabled={saving || !title.trim()}>
            {saving ? 'Converting…' : 'Convert to a deal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
