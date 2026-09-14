'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormField } from '@/components/settings/form-field';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { OPT_IN_METHOD_LABELS } from '@/lib/crm-display';

type Contact = (typeof api.contacts.listForClient._returnType)[number];
type OptInMethod = keyof typeof OPT_IN_METHOD_LABELS;

const dateOnly = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' });

export const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name the contact').max(120),
  email: z.string().trim().email('Enter an email address'),
  jobTitle: z.string().trim().max(120),
  phone: z.string().trim(),
  whatsapp: z.string().trim(),
  isBilling: z.boolean(),
});

type ContactValues = z.infer<typeof contactSchema>;

export function ContactsPanel({ clientId, permissions }: { clientId: Id<'clients'>; permissions: string[] }) {
  const [includeLeft, setIncludeLeft] = useState(false);
  const contacts = useQuery(api.contacts.listForClient, { clientId, includeLeft });
  const canManage = permissions.includes('contacts.manage');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch id="contacts-include-left" checked={includeLeft} onCheckedChange={setIncludeLeft} />
          <Label htmlFor="contacts-include-left" className="font-normal">
            Show people who left
          </Label>
        </div>
        {canManage && (
          <div className="sm:ml-auto">
            <ContactDialog
              clientId={clientId}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  Add contact
                </Button>
              }
            />
          </div>
        )}
      </div>

      {contacts === undefined ? (
        <p className="text-muted-foreground">Loading contacts…</p>
      ) : contacts.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">No contacts yet.</p>
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {contacts.map((contact) => (
            <ContactCard key={contact.id} contact={contact} canManage={canManage} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ContactCard({ contact, canManage }: { contact: Contact; canManage: boolean }) {
  const setPrimary = useMutation(api.contacts.setPrimary);
  const markLeft = useMutation(api.contacts.markLeft);
  const markReturned = useMutation(api.contacts.markReturned);
  const remove = useMutation(api.contacts.remove);
  const withdraw = useMutation(api.contacts.withdrawWhatsappOptIn);
  const left = contact.status === 'left';

  return (
    <li className="space-y-4 rounded-lg border p-4" aria-label={contact.name}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0">
          <p className="font-medium">{contact.name}</p>
          <p className="text-sm text-muted-foreground">
            {[contact.jobTitle, contact.email].filter(Boolean).join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:ml-auto">
          {contact.isPrimary && <ToneBadge label="Primary" tone="built" />}
          {contact.isBilling && <ToneBadge label="Billing" tone="muted" />}
          {left && (
            <ToneBadge label={`Left${contact.leftAt ? ` ${dateOnly.format(contact.leftAt)}` : ''}`} tone="muted" />
          )}
        </div>
      </div>

      <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Phone</dt>
        <dd>{contact.phone ?? '—'}</dd>
        <dt className="text-muted-foreground">WhatsApp</dt>
        <dd>
          {contact.whatsapp ?? '—'}
          {contact.whatsapp && (
            <span className="ml-2">
              {contact.whatsappOptIn ? (
                <ToneBadge label={`Opted in (${OPT_IN_METHOD_LABELS[contact.whatsappOptIn.method]})`} tone="built" />
              ) : (
                <ToneBadge label="No opt-in" tone="draft" />
              )}
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">Portal</dt>
        <dd>
          {contact.portalAccess ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {contact.portalRole?.name}
              {contact.hasSignedIn ? (
                <ToneBadge label="Signed in" tone="built" />
              ) : (
                <ToneBadge label="Invited" tone="draft" />
              )}
            </span>
          ) : (
            'No access'
          )}
        </dd>
      </dl>

      {canManage && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          {!left && (
            <>
              <ContactDialog
                clientId={contact.clientId}
                contact={contact}
                trigger={
                  <Button variant="outline" size="sm">
                    Edit
                  </Button>
                }
              />
              {!contact.isPrimary && (
                <Button variant="outline" size="sm" onClick={() => void setPrimary({ contactId: contact.id })}>
                  Make primary
                </Button>
              )}
              <PortalAccess contact={contact} />
              {contact.whatsapp &&
                (contact.whatsappOptIn ? (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm">
                        Withdraw WhatsApp opt-in
                      </Button>
                    }
                    title={`Withdraw ${contact.name}’s WhatsApp opt-in?`}
                    description="No more WhatsApp messages go to them until consent is recorded again."
                    confirmLabel="Withdraw"
                    onConfirm={() => withdraw({ contactId: contact.id })}
                  />
                ) : (
                  <OptInDialog contact={contact} />
                ))}
              <ConfirmDialog
                trigger={
                  <Button variant="ghost" size="sm">
                    Mark as left
                  </Button>
                }
                title={`Has ${contact.name} left?`}
                description="Their portal access ends at once and they are signed out. Their history stays on the timeline."
                confirmLabel="Mark as left"
                onConfirm={() => markLeft({ contactId: contact.id })}
              />
            </>
          )}
          {left && (
            <Button variant="outline" size="sm" onClick={() => void markReturned({ contactId: contact.id })}>
              Mark as a contact again
            </Button>
          )}
          {!contact.hasSignedIn && (
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="sm">
                  Delete
                </Button>
              }
              title={`Delete ${contact.name}?`}
              description="For a contact added by mistake. Their timeline entries are deleted too."
              confirmLabel="Delete"
              onConfirm={() => remove({ contactId: contact.id })}
            />
          )}
        </div>
      )}
    </li>
  );
}

function ContactDialog({
  clientId,
  contact,
  trigger,
}: {
  clientId: Id<'clients'>;
  contact?: Contact;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useMutation(api.contacts.create);
  const update = useMutation(api.contacts.update);
  const defaults: ContactValues = {
    name: contact?.name ?? '',
    email: contact?.email ?? '',
    jobTitle: contact?.jobTitle ?? '',
    phone: contact?.phone ?? '',
    whatsapp: contact?.whatsapp ?? '',
    isBilling: contact?.isBilling ?? false,
  };
  const form = useForm<ContactValues>({ resolver: zodResolver(contactSchema), defaultValues: defaults });
  const { errors, isSubmitting } = form.formState;
  const emailLocked = !!contact && (contact.portalAccess || contact.hasSignedIn);
  const formId = contact ? `contact-form-${contact.id}` : 'contact-form-new';

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const args = {
      name: values.name,
      email: values.email,
      jobTitle: values.jobTitle || undefined,
      phone: values.phone || undefined,
      whatsapp: values.whatsapp || undefined,
      isBilling: values.isBilling,
    };
    try {
      if (contact) await update({ contactId: contact.id, ...args });
      else await create({ clientId, ...args });
      setOpen(false);
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset(defaults);
        setServerError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{contact ? `Edit ${contact.name}` : 'Add a contact'}</DialogTitle>
          <DialogDescription>
            {contact?.whatsappOptIn
              ? 'Changing the WhatsApp number withdraws their opt-in, which was given for the old number.'
              : 'The first contact becomes the primary contact.'}
          </DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={onSubmit} noValidate className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${formId}-name`} label="Name" error={errors.name?.message}>
              {(field) => <Input {...field} {...form.register('name')} autoComplete="off" />}
            </FormField>
            <FormField id={`${formId}-title`} label="Job title (optional)">
              {(field) => <Input {...field} {...form.register('jobTitle')} />}
            </FormField>
          </div>
          <FormField
            id={`${formId}-email`}
            label="Email"
            help={emailLocked ? 'They sign in to the portal with this address, so it cannot change.' : undefined}
            error={errors.email?.message}
          >
            {(field) => <Input {...field} {...form.register('email')} type="email" readOnly={emailLocked} />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id={`${formId}-phone`} label="Phone (optional)" help="Such as +2348012345678">
              {(field) => <Input {...field} {...form.register('phone')} type="tel" />}
            </FormField>
            <FormField id={`${formId}-whatsapp`} label="WhatsApp (optional)" help="International format">
              {(field) => <Input {...field} {...form.register('whatsapp')} type="tel" />}
            </FormField>
          </div>
          <div className="flex items-center gap-2">
            <Controller
              control={form.control}
              name="isBilling"
              render={({ field }) => (
                <Checkbox
                  id={`${formId}-billing`}
                  checked={field.value}
                  onCheckedChange={(checked) => field.onChange(checked === true)}
                />
              )}
            />
            <Label htmlFor={`${formId}-billing`} className="font-normal">
              Billing contact (receives invoices)
            </Label>
          </div>
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={formId} disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : contact ? 'Save contact' : 'Add contact'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PortalAccess({ contact }: { contact: Contact }) {
  const roles = useQuery(api.contacts.portalRoles, {});
  const grant = useMutation(api.contacts.grantPortalAccess);
  const resend = useMutation(api.contacts.resendPortalInvite);
  const setRole = useMutation(api.contacts.setPortalRole);
  const revoke = useMutation(api.contacts.revokePortalAccess);
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  if (!contact.portalAccess) {
    return (
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm">
            Give portal access
          </Button>
        }
        title={`Give ${contact.name} portal access?`}
        description={`They get an email to sign in to the client portal as ${contact.email}.`}
        confirmLabel="Give access and send invite"
        onConfirm={() => grant({ contactId: contact.id, roleId: (roleId || undefined) as Id<'roles'> | undefined })}
      >
        <div className="space-y-2">
          <Label htmlFor={`portal-role-${contact.id}`}>Role</Label>
          <NativeSelect
            id={`portal-role-${contact.id}`}
            value={roleId}
            onChange={(event) => setRoleId(event.target.value)}
          >
            <option value="">Automatic: Client admin if they are the first, otherwise Client member</option>
            {roles?.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </ConfirmDialog>
    );
  }

  return (
    <>
      <ConfirmDialog
        trigger={
          <Button variant="outline" size="sm">
            Portal role
          </Button>
        }
        title={`${contact.name}’s portal role`}
        description={roles?.find((role) => role.id === (roleId || contact.portalRole?.id))?.description ?? ''}
        confirmLabel="Save role"
        canConfirm={!!roleId && roleId !== contact.portalRole?.id}
        onConfirm={() => setRole({ contactId: contact.id, roleId: roleId as Id<'roles'> })}
      >
        <div className="space-y-2">
          <Label htmlFor={`portal-role-change-${contact.id}`}>Role</Label>
          <NativeSelect
            id={`portal-role-change-${contact.id}`}
            value={roleId || contact.portalRole?.id || ''}
            onChange={(event) => setRoleId(event.target.value)}
          >
            {roles?.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </ConfirmDialog>
      {!contact.hasSignedIn && (
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await resend({ contactId: contact.id });
              setStatus('Invitation sent again.');
            } catch (error) {
              setStatus(errorMessage(error));
            }
          }}
        >
          Resend invite
        </Button>
      )}
      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="sm">
            Remove portal access
          </Button>
        }
        title={`Remove ${contact.name}’s portal access?`}
        description="They are signed out at once. You can give access back later."
        confirmLabel="Remove access"
        onConfirm={() => revoke({ contactId: contact.id })}
      />
      <span aria-live="polite" className="self-center text-sm text-muted-foreground">
        {status}
      </span>
    </>
  );
}

function OptInDialog({ contact }: { contact: Contact }) {
  const record = useMutation(api.contacts.recordWhatsappOptIn);
  const [method, setMethod] = useState<OptInMethod>('written_consent');
  return (
    <ConfirmDialog
      trigger={
        <Button variant="ghost" size="sm">
          Record WhatsApp opt-in
        </Button>
      }
      title={`Record ${contact.name}’s WhatsApp opt-in`}
      description={`Only record consent they actually gave for ${contact.whatsapp}. No WhatsApp message is sent without it.`}
      confirmLabel="Record opt-in"
      onConfirm={() => record({ contactId: contact.id, method })}
    >
      <div className="space-y-2">
        <Label htmlFor={`opt-in-method-${contact.id}`}>How they agreed</Label>
        <NativeSelect
          id={`opt-in-method-${contact.id}`}
          value={method}
          onChange={(event) => setMethod(event.target.value as OptInMethod)}
        >
          {Object.entries(OPT_IN_METHOD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </div>
    </ConfirmDialog>
  );
}
