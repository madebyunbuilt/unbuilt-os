'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormDialog } from '@/components/app/form-dialog';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency, formatMoney, parseMoneyInput } from '@/convex/lib/money';
import { type ChangeRequestStatus, changeRequestStatus } from '@/lib/change-requests-display';
import { toAmountInput } from '@/lib/crm-display';

// Change requests (06-projects.md, Change requests): a priced change to agreed scope. Approving one moves the
// project's budget and due date and bills the amount, so the screen says what will happen before it is sent.

type ChangeRequest = (typeof api.changeRequests.listForProject._returnType)[number];

function ChangeRequestFormDialog({
  projectId,
  changeRequest,
  trigger,
}: {
  projectId: Id<'projects'>;
  changeRequest?: ChangeRequest;
  trigger: ReactNode;
}) {
  const create = useMutation(api.changeRequests.create);
  const update = useMutation(api.changeRequests.update);
  // A change request is priced in the project's own currency; the server sets it and will not take another.
  const project = useQuery(api.projects.get, { projectId });
  const [title, setTitle] = useState(changeRequest?.title ?? '');
  const [description, setDescription] = useState(changeRequest?.description ?? '');
  const [reason, setReason] = useState(changeRequest?.reason ?? '');
  const [amount, setAmount] = useState(changeRequest ? toAmountInput(changeRequest.impact.amountMinor) : '');
  const [days, setDays] = useState(String(changeRequest?.impact.days ?? 0));
  const [billing, setBilling] = useState(changeRequest?.billing ?? 'invoice_now');
  const currency = (changeRequest?.impact.currency ?? project?.currency) as Currency | undefined;

  return (
    <FormDialog
      trigger={trigger}
      title={changeRequest ? 'Change this request' : 'New change request'}
      description="A priced change to what was agreed. Approving it moves the project's budget and due date, and bills the amount."
      submitLabel={changeRequest ? 'Save' : 'Create'}
      canSubmit={
        Boolean(currency) && title.trim().length > 0 && description.trim().length > 0 && reason.trim().length > 0
      }
      onSubmit={async () => {
        const details = {
          title,
          description,
          reason,
          amountMinor: amount.trim() ? parseMoneyInput(amount, currency!) : 0,
          days: Number(days) || 0,
          billing: billing as 'invoice_now',
        };
        if (changeRequest) await update({ changeRequestId: changeRequest.id, ...details });
        else await create({ projectId, ...details });
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="cr-title">What is changing</Label>
        <Input id="cr-title" value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cr-description">In full, for the client</Label>
        <Textarea
          id="cr-description"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cr-reason">Why it is needed</Label>
        <Textarea id="cr-reason" rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cr-amount">What it adds{currency ? ` (${currency})` : ''}</Label>
          <Input
            id="cr-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="cr-days">Days it adds</Label>
          <Input id="cr-days" inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="cr-billing">How it is billed</Label>
        <NativeSelect
          id="cr-billing"
          value={billing}
          onChange={(event) => setBilling(event.target.value as 'invoice_now')}
        >
          <option value="invoice_now">Invoice it as soon as it is approved</option>
          <option value="with_the_schedule">Add it to the project&rsquo;s billing schedule</option>
        </NativeSelect>
      </div>
    </FormDialog>
  );
}

function SendDialog({ changeRequest }: { changeRequest: ChangeRequest }) {
  const send = useMutation(api.changeRequests.send);
  const [message, setMessage] = useState('');
  return (
    <FormDialog
      trigger={<Button>Send it</Button>}
      title="Send this change request"
      description="It takes its number and goes to the client as a change request document. Whether it needs signing is settled now."
      submitLabel="Send"
      onSubmit={() => send({ changeRequestId: changeRequest.id, message: message || undefined })}
    >
      <div className="space-y-2">
        <Label htmlFor="cr-message">A note with it (optional)</Label>
        <Textarea id="cr-message" rows={3} value={message} onChange={(event) => setMessage(event.target.value)} />
      </div>
    </FormDialog>
  );
}

function DecisionDialogs({ changeRequest }: { changeRequest: ChangeRequest }) {
  const recordDecision = useMutation(api.changeRequests.recordDecision);
  const withdraw = useMutation(api.changeRequests.withdraw);
  const contacts = useQuery(api.contacts.listForClient, { clientId: changeRequest.clientId });
  const [contactId, setContactId] = useState('');
  const [reason, setReason] = useState('');
  const [withdrawReason, setWithdrawReason] = useState('');
  const active = (contacts ?? []).filter((contact) => contact.status === 'active');

  return (
    <>
      {!changeRequest.needsSignature && (
        <>
          <ConfirmDialog
            trigger={<Button>They approved it</Button>}
            title="Record their approval"
            description="This moves the project's budget and due date and bills the amount, once."
            confirmLabel="Record it"
            onConfirm={() =>
              recordDecision({
                changeRequestId: changeRequest.id,
                decision: 'approved',
                contactId: contactId ? (contactId as Id<'contacts'>) : undefined,
              })
            }
          >
            <div className="space-y-2">
              <Label htmlFor="cr-contact">Who said so (optional)</Label>
              <NativeSelect id="cr-contact" value={contactId} onChange={(event) => setContactId(event.target.value)}>
                <option value="">Not recorded</option>
                {active.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </ConfirmDialog>
          <FormDialog
            trigger={<Button variant="outline">They declined</Button>}
            title="Record their refusal"
            description="The project is left exactly as it was."
            submitLabel="Record it"
            onSubmit={() =>
              recordDecision({ changeRequestId: changeRequest.id, decision: 'declined', reason: reason || undefined })
            }
          >
            <div className="space-y-2">
              <Label htmlFor="cr-decline-reason">What they said (optional)</Label>
              <Textarea
                id="cr-decline-reason"
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </FormDialog>
        </>
      )}
      <FormDialog
        trigger={<Button variant="ghost">Withdraw</Button>}
        title="Withdraw this change request"
        description="It stays on record with the reason, and the client can no longer act on it."
        submitLabel="Withdraw"
        canSubmit={withdrawReason.trim().length > 0}
        onSubmit={() => withdraw({ changeRequestId: changeRequest.id, reason: withdrawReason })}
      >
        <div className="space-y-2">
          <Label htmlFor="cr-withdraw-reason">Why</Label>
          <Textarea
            id="cr-withdraw-reason"
            rows={2}
            value={withdrawReason}
            onChange={(event) => setWithdrawReason(event.target.value)}
          />
        </div>
      </FormDialog>
    </>
  );
}

export function ChangeRequestsPanel({ projectId, permissions }: { projectId: Id<'projects'>; permissions: string[] }) {
  const changeRequests = useQuery(api.changeRequests.listForProject, { projectId });
  const remove = useMutation(api.changeRequests.remove);
  const canCreate = permissions.includes('changerequests.create');
  const canSend = permissions.includes('changerequests.send');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Change requests</h2>
          <p className="text-sm text-muted-foreground">
            A priced change to what was agreed. Approving one moves the budget and the due date with it.
          </p>
        </div>
        {canCreate && (
          <ChangeRequestFormDialog
            projectId={projectId}
            trigger={
              <Button>
                <Plus aria-hidden />
                New change request
              </Button>
            }
          />
        )}
      </div>

      {changeRequests === undefined ? (
        <p className="text-muted-foreground">Loading change requests…</p>
      ) : changeRequests.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          None yet. Raise one when the scope changes and the client needs to agree a price.
        </p>
      ) : (
        <ul className="space-y-3">
          {changeRequests.map((changeRequest) => {
            const currency = changeRequest.impact.currency as Currency;
            return (
              <li key={changeRequest.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {changeRequest.number ? `${changeRequest.number}: ` : ''}
                      {changeRequest.title}
                    </p>
                    <p className="text-sm text-muted-foreground">{changeRequest.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium tabular-nums">
                      {formatMoney(changeRequest.impact.amountMinor, currency)}
                    </p>
                    {changeRequest.impact.days > 0 && (
                      <p className="text-sm text-muted-foreground">
                        and {changeRequest.impact.days} day{changeRequest.impact.days === 1 ? '' : 's'}
                      </p>
                    )}
                    <ToneBadge {...changeRequestStatus(changeRequest.status as ChangeRequestStatus)} />
                  </div>
                </div>

                <p className="mt-2 text-sm text-muted-foreground">{changeRequest.reason}</p>

                {changeRequest.status === 'sent' && changeRequest.needsSignature && (
                  <p className="mt-2 rounded-md border p-3 text-sm">
                    Above the studio&rsquo;s threshold, so this one is approved by the client signing it. Set the
                    signing up on{' '}
                    {changeRequest.documentId ? (
                      <Link href={`/documents/${changeRequest.documentId}`} className="underline">
                        its document
                      </Link>
                    ) : (
                      'its document'
                    )}
                    .
                  </p>
                )}
                {changeRequest.declineReason && (
                  <p className="mt-2 rounded-md border p-3 text-sm text-muted-foreground">
                    {changeRequest.declineReason}
                  </p>
                )}
                {changeRequest.invoiceId && (
                  <p className="mt-2 text-sm">
                    <Link href={`/billing/invoices/${changeRequest.invoiceId}`} className="underline">
                      See the invoice it raised
                    </Link>
                  </p>
                )}
                {changeRequest.status === 'approved' && !changeRequest.invoiceId && (
                  <p className="mt-2 text-sm text-muted-foreground">Added to the project&rsquo;s billing schedule.</p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {canCreate && changeRequest.status === 'draft' && (
                    <>
                      <ChangeRequestFormDialog
                        projectId={projectId}
                        changeRequest={changeRequest}
                        trigger={<Button variant="outline">Change it</Button>}
                      />
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" className="text-destructive">
                            Delete
                          </Button>
                        }
                        title="Delete this change request"
                        description="It has not gone to the client, so nothing is kept."
                        confirmLabel="Delete"
                        onConfirm={() => remove({ changeRequestId: changeRequest.id })}
                      />
                    </>
                  )}
                  {canSend && changeRequest.status === 'draft' && <SendDialog changeRequest={changeRequest} />}
                  {canSend && changeRequest.status === 'sent' && <DecisionDialogs changeRequest={changeRequest} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
