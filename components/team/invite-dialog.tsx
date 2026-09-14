'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from 'convex/react';
import { UserPlus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
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
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';

export const inviteSchema = z.object({
  email: z.string().trim().email('Enter an email address'),
  name: z.string().trim().min(1, 'Name is required').max(120),
  title: z.string().trim().max(120),
  roleId: z.string().min(1, 'Choose a role'),
  employmentType: z.enum(['employee', 'contractor']),
  timezone: z.string().min(1),
});

type InviteValues = z.infer<typeof inviteSchema>;

const defaults: InviteValues = {
  email: '',
  name: '',
  title: '',
  roleId: '',
  employmentType: 'employee',
  timezone: 'Africa/Lagos',
};

export function InviteDialog({ onInvited }: { onInvited?: (memberId: Id<'teamMembers'>) => void }) {
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const roles = useQuery(api.team.assignableRoles, open ? {} : 'skip');
  const invite = useMutation(api.team.invite);
  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: defaults });
  const { errors, isSubmitting } = form.formState;
  const chosenRoleId = useWatch({ control: form.control, name: 'roleId' });

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const memberId = await invite({
        email: values.email,
        name: values.name,
        title: values.title || undefined,
        roleId: values.roleId as Id<'roles'>,
        employmentType: values.employmentType,
        timezone: values.timezone,
        skills: [],
      });
      form.reset(defaults);
      setOpen(false);
      onInvited?.(memberId);
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setServerError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Invite a team member</DialogTitle>
          <DialogDescription>
            They get an email to sign in and set up two-factor authentication. The invitation expires in 14 days.
          </DialogDescription>
        </DialogHeader>
        <form id="invite-form" onSubmit={onSubmit} noValidate className="space-y-4">
          <FormField id="invite-email" label="Email" error={errors.email?.message}>
            {(field) => <Input {...field} {...form.register('email')} type="email" autoComplete="off" />}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="invite-name" label="Name" error={errors.name?.message}>
              {(field) => <Input {...field} {...form.register('name')} autoComplete="off" />}
            </FormField>
            <FormField id="invite-title" label="Job title (optional)" error={errors.title?.message}>
              {(field) => <Input {...field} {...form.register('title')} />}
            </FormField>
          </div>
          <FormField
            id="invite-role"
            label="Role"
            help={roles?.find((role) => role.id === chosenRoleId)?.description}
            error={errors.roleId?.message}
          >
            {(field) => (
              <NativeSelect {...field} {...form.register('roleId')} disabled={!roles}>
                <option value="">{roles ? 'Choose a role' : 'Loading roles…'}</option>
                {roles?.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="invite-employment" label="Employment" error={errors.employmentType?.message}>
              {(field) => (
                <NativeSelect {...field} {...form.register('employmentType')}>
                  <option value="employee">Employee</option>
                  <option value="contractor">Contractor</option>
                </NativeSelect>
              )}
            </FormField>
            <FormField id="invite-timezone" label="Timezone" error={errors.timezone?.message}>
              {(field) => (
                <NativeSelect {...field} {...form.register('timezone')}>
                  {timezones.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replaceAll('_', ' ')}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          </div>
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form="invite-form" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send invitation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
