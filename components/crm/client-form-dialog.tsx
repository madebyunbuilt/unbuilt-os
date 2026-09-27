'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from 'convex/react';
import { type ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { COUNTRIES, isCountryCode } from '@/lib/countries';
import { FormField } from '@/components/settings/form-field';
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
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { splitTags } from '@/lib/crm-display';

export const clientSchema = z.object({
  displayName: z.string().trim().min(1, 'Name the client').max(120),
  kind: z.enum(['company', 'individual']),
  industry: z.string().trim().max(60),
  website: z.string().trim().max(200),
  // Chosen from a list rather than typed: SP looks like Spain and is not a country, and nothing would have said so.
  country: z
    .string()
    .trim()
    .refine((value) => value === '' || isCountryCode(value), 'Choose a country from the list'),
  ownerMemberId: z.string(),
  source: z.string().trim().max(60),
  tags: z.string(),
  notes: z.string().trim().max(2000),
});

type Values = z.infer<typeof clientSchema>;

export type EditableClient = {
  id: Id<'clients'>;
  displayName: string;
  kind: 'company' | 'individual';
  industry?: string;
  website?: string;
  country?: string;
  ownerMemberId?: Id<'teamMembers'>;
  source?: string;
  tags: string[];
  notes?: string;
};

const toValues = (client?: EditableClient): Values => ({
  displayName: client?.displayName ?? '',
  kind: client?.kind ?? 'company',
  industry: client?.industry ?? '',
  website: client?.website ?? '',
  country: client?.country ?? '',
  ownerMemberId: client?.ownerMemberId ?? '',
  source: client?.source ?? '',
  tags: client?.tags.join(', ') ?? '',
  notes: client?.notes ?? '',
});

/** Creates a client, or edits one when `client` is given. */
export function ClientFormDialog({
  trigger,
  client,
  canPickOwner,
  onSaved,
}: {
  trigger: ReactNode;
  client?: EditableClient;
  /** Whether the viewer can list the team (team.view) to choose an owner. */
  canPickOwner: boolean;
  onSaved?: (clientId: Id<'clients'>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useMutation(api.clients.create);
  const update = useMutation(api.clients.update);
  const team = useQuery(api.team.list, open && canPickOwner ? {} : 'skip');
  const facets = useQuery(api.clients.facets, open ? {} : 'skip');
  const form = useForm<Values>({ resolver: zodResolver(clientSchema), defaultValues: toValues(client) });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const args = {
      displayName: values.displayName,
      kind: values.kind,
      industry: values.industry || undefined,
      website: values.website || undefined,
      country: values.country || undefined,
      ownerMemberId: (values.ownerMemberId || undefined) as Id<'teamMembers'> | undefined,
      source: values.source || undefined,
      tags: splitTags(values.tags),
      notes: values.notes || undefined,
    };
    try {
      let clientId: Id<'clients'>;
      if (client) {
        await update({ clientId: client.id, ...args });
        clientId = client.id;
      } else {
        clientId = await create(args);
      }
      setOpen(false);
      if (!client) form.reset(toValues());
      onSaved?.(clientId);
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(toValues(client));
        setServerError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{client ? `Edit ${client.displayName}` : 'New client'}</DialogTitle>
          <DialogDescription>
            {client ? 'Billing details are in the client’s Settings tab.' : 'New clients start as leads.'}
          </DialogDescription>
        </DialogHeader>
        <form id="client-form" onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <FormField id="client-name" label="Name" error={errors.displayName?.message}>
              {(field) => <Input {...field} {...form.register('displayName')} autoComplete="off" />}
            </FormField>
            <FormField id="client-kind" label="Kind">
              {(field) => (
                <NativeSelect {...field} {...form.register('kind')}>
                  <option value="company">Company</option>
                  <option value="individual">Individual</option>
                </NativeSelect>
              )}
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="client-industry" label="Industry (optional)" error={errors.industry?.message}>
              {(field) => (
                <>
                  <Input {...field} {...form.register('industry')} list="client-industries" />
                  <datalist id="client-industries">
                    {facets?.industries.map((industry) => (
                      <option key={industry} value={industry} />
                    ))}
                  </datalist>
                </>
              )}
            </FormField>
            <FormField id="client-website" label="Website (optional)" error={errors.website?.message}>
              {(field) => <Input {...field} {...form.register('website')} placeholder="glossup.com" />}
            </FormField>
            <FormField id="client-country" label="Country (optional)" error={errors.country?.message}>
              {(field) => (
                <NativeSelect {...field} {...form.register('country')}>
                  <option value="">Not said</option>
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.code}>
                      {country.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
            <FormField
              id="client-source"
              label="Source (optional)"
              help="Such as referral or website"
              error={errors.source?.message}
            >
              {(field) => <Input {...field} {...form.register('source')} />}
            </FormField>
          </div>
          {canPickOwner && (
            <FormField id="client-owner" label="Owner" help={client ? undefined : 'Leave empty to own it yourself.'}>
              {(field) => (
                <NativeSelect {...field} {...form.register('ownerMemberId')} disabled={!team}>
                  <option value="">{client ? 'No owner' : 'Me'}</option>
                  {team
                    ?.filter((member) => member.status === 'active')
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                </NativeSelect>
              )}
            </FormField>
          )}
          <FormField id="client-tags" label="Tags (optional)" help="Separate with commas">
            {(field) => <Input {...field} {...form.register('tags')} />}
          </FormField>
          <FormField id="client-notes" label="Notes (optional)" error={errors.notes?.message}>
            {(field) => <Textarea {...field} {...form.register('notes')} rows={3} />}
          </FormField>
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form="client-form" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : client ? 'Save client' : 'Create client'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
