'use client';

import { useMutation, useQuery } from 'convex/react';
import { type ReactNode, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { SERVICE_LABELS } from '@/convex/lib/enquiries';
import { type Currency, formatBpsAsPercent, parseMoneyInput, parsePercentToBps } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';
import { toAmountInput } from '@/lib/crm-display';

export type EditableDeal = NonNullable<typeof api.deals.get._returnType>;

type Values = {
  clientId: string;
  primaryContactId: string;
  title: string;
  amount: string;
  currency: Currency;
  probability: string;
  expectedCloseDate: string;
  ownerMemberId: string;
  services: string[];
  source: string;
  nextFollowUpDate: string;
};

const toValues = (deal: EditableDeal | undefined, clientId: string | undefined): Values => ({
  clientId: deal?.clientId ?? clientId ?? '',
  primaryContactId: deal?.primaryContact?.id ?? '',
  title: deal?.title ?? '',
  amount: toAmountInput(deal?.valueMinor),
  currency: deal?.currency ?? 'NGN',
  probability: deal ? formatBpsAsPercent(deal.probabilityBps) : '',
  expectedCloseDate: deal?.expectedCloseDate ?? '',
  ownerMemberId: deal?.ownerMemberId ?? '',
  services: deal?.services ?? [],
  source: deal?.source ?? '',
  nextFollowUpDate: deal?.nextFollowUpDate ?? '',
});

/** Creates a deal (for `clientId` when given, otherwise the chosen client), or edits `deal`. */
export function DealFormDialog({
  trigger,
  deal,
  clientId,
  canPickOwner,
  onSaved,
}: {
  trigger: ReactNode;
  deal?: EditableDeal;
  clientId?: Id<'clients'>;
  canPickOwner: boolean;
  onSaved?: (dealId: Id<'deals'>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Values>(() => toValues(deal, clientId));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const create = useMutation(api.deals.create);
  const update = useMutation(api.deals.update);
  const pickClient = !deal && !clientId;
  const clients = useQuery(api.clients.list, open && pickClient ? {} : 'skip');
  const contacts = useQuery(
    api.contacts.listForClient,
    open && values.clientId ? { clientId: values.clientId as Id<'clients'> } : 'skip',
  );
  const team = useQuery(api.team.list, open && canPickOwner ? {} : 'skip');
  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const formId = deal ? `deal-form-${deal.id}` : 'deal-form-new';

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (!values.clientId) throw new Error('Choose the client');
      const common = {
        title: values.title,
        primaryContactId: (values.primaryContactId || undefined) as Id<'contacts'> | undefined,
        valueMinor: values.amount.trim() ? parseMoneyInput(values.amount, values.currency) : 0,
        currency: values.currency,
        probabilityBps: values.probability.trim() ? parsePercentToBps(values.probability) : undefined,
        expectedCloseDate: values.expectedCloseDate || undefined,
        ownerMemberId: (values.ownerMemberId || undefined) as Id<'teamMembers'> | undefined,
        services: values.services,
        source: values.source || undefined,
        nextFollowUpDate: values.nextFollowUpDate || undefined,
      };
      let dealId: Id<'deals'>;
      if (deal) {
        await update({ dealId: deal.id, ...common });
        dealId = deal.id;
      } else {
        dealId = await create({ clientId: values.clientId as Id<'clients'>, ...common });
      }
      setOpen(false);
      onSaved?.(dealId);
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
        if (next) setValues(toValues(deal, clientId));
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{deal ? `Edit ${deal.title}` : 'New deal'}</DialogTitle>
          <DialogDescription>
            {deal
              ? 'Move the deal between stages from the deal page or the board.'
              : 'New deals start in the first stage, with its win probability unless you set one.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {pickClient && (
            <div className="space-y-2">
              <Label htmlFor={`${formId}-client`}>Client</Label>
              <NativeSelect
                id={`${formId}-client`}
                value={values.clientId}
                disabled={!clients}
                onChange={(event) => setValues({ ...values, clientId: event.target.value, primaryContactId: '' })}
              >
                <option value="">{clients ? 'Choose a client' : 'Loading clients…'}</option>
                {clients?.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.displayName}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor={`${formId}-title`}>Title</Label>
            <Input
              id={`${formId}-title`}
              value={values.title}
              placeholder="Such as E-commerce rebuild"
              onChange={(event) => set('title', event.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-[1fr_7rem_7rem]">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-amount`}>Value</Label>
              <Input
                id={`${formId}-amount`}
                inputMode="decimal"
                value={values.amount}
                onChange={(event) => set('amount', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-currency`}>Currency</Label>
              <NativeSelect
                id={`${formId}-currency`}
                value={values.currency}
                onChange={(event) => set('currency', event.target.value as Currency)}
              >
                <option value="NGN">NGN</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-probability`}>Win %</Label>
              <Input
                id={`${formId}-probability`}
                inputMode="decimal"
                placeholder="Stage"
                value={values.probability}
                onChange={(event) => set('probability', event.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${formId}-contact`}>Contact (optional)</Label>
              <NativeSelect
                id={`${formId}-contact`}
                value={values.primaryContactId}
                disabled={!values.clientId || !contacts}
                onChange={(event) => set('primaryContactId', event.target.value)}
              >
                <option value="">No contact</option>
                {contacts?.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {canPickOwner && (
              <div className="space-y-2">
                <Label htmlFor={`${formId}-owner`}>Owner</Label>
                <NativeSelect
                  id={`${formId}-owner`}
                  value={values.ownerMemberId}
                  disabled={!team}
                  onChange={(event) => set('ownerMemberId', event.target.value)}
                >
                  <option value="">{deal ? 'Keep current owner' : 'Me'}</option>
                  {team
                    ?.filter((member) => member.status === 'active')
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                </NativeSelect>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={`${formId}-close`}>Expected close (optional)</Label>
              <Input
                id={`${formId}-close`}
                type="date"
                value={values.expectedCloseDate}
                onChange={(event) => set('expectedCloseDate', event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-follow-up`}>Next follow-up (optional)</Label>
              <Input
                id={`${formId}-follow-up`}
                type="date"
                value={values.nextFollowUpDate}
                onChange={(event) => set('nextFollowUpDate', event.target.value)}
              />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Services</legend>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(SERVICE_LABELS).map(([slug, label]) => (
                <div key={slug} className="flex items-center gap-2">
                  <Checkbox
                    id={`${formId}-service-${slug}`}
                    checked={values.services.includes(slug)}
                    onCheckedChange={(checked) =>
                      set(
                        'services',
                        checked === true
                          ? [...values.services, slug]
                          : values.services.filter((service) => service !== slug),
                      )
                    }
                  />
                  <Label htmlFor={`${formId}-service-${slug}`} className="font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-source`}>Source (optional)</Label>
            <Input
              id={`${formId}-source`}
              value={values.source}
              placeholder="Such as referral"
              onChange={(event) => set('source', event.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={formId} disabled={saving || !values.title.trim()}>
            {saving ? 'Saving…' : deal ? 'Save deal' : 'Create deal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
