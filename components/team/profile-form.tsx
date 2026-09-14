'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from 'convex/react';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormField, SaveStatus } from '@/components/settings/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { hoursToMinutes, minutesToHours } from '@/lib/team-display';

const e164 = z
  .string()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .refine(
    (value) => value === '' || /^\+[1-9]\d{7,14}$/.test(value),
    'Use an international number, such as +2348012345678',
  );

export const profileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  title: z.string().trim().max(120),
  employmentType: z.enum(['employee', 'contractor']),
  phone: e164,
  whatsapp: e164,
  timezone: z.string().min(1),
  skills: z.string(),
  startDate: z.string().refine((value) => value === '' || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Choose a date'),
  capacityHours: z.string().refine((value) => {
    const minutes = hoursToMinutes(value);
    return minutes === undefined || (!Number.isNaN(minutes) && minutes <= 100 * 60);
  }, 'Enter hours per week, up to 100'),
});

type ProfileValues = z.input<typeof profileSchema>;

export type ProfileMember = {
  id: Id<'teamMembers'>;
  name: string;
  title?: string;
  employmentType: 'employee' | 'contractor';
  email: string;
  phone?: string;
  whatsapp?: string;
  timezone: string;
  skills: string[];
  startDate?: string;
  capacityMinutesPerWeek?: number;
};

export const splitSkills = (value: string) =>
  value
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean);

export function ProfileForm({ member, editable }: { member: ProfileMember; editable: boolean }) {
  const update = useMutation(api.team.updateProfile);
  const timezones = useMemo(() => Intl.supportedValuesOf('timeZone'), []);
  const [status, setStatus] = useState<{ kind: 'idle' } | { kind: 'saved' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });
  const values: ProfileValues = {
    name: member.name,
    title: member.title ?? '',
    employmentType: member.employmentType,
    phone: member.phone ?? '',
    whatsapp: member.whatsapp ?? '',
    timezone: member.timezone,
    skills: member.skills.join(', '),
    startDate: member.startDate ?? '',
    capacityHours: minutesToHours(member.capacityMinutesPerWeek),
  };
  const form = useForm<ProfileValues, unknown, z.output<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    values,
    resetOptions: { keepDirtyValues: true },
  });
  const { errors, isDirty, isSubmitting } = form.formState;

  if (!editable) {
    const rows: [string, string | undefined][] = [
      ['Email', member.email],
      ['Title', member.title],
      ['Employment', member.employmentType === 'contractor' ? 'Contractor' : 'Employee'],
      ['Phone', member.phone],
      ['WhatsApp', member.whatsapp],
      ['Timezone', member.timezone.replaceAll('_', ' ')],
      ['Skills', member.skills.join(', ')],
      ['Start date', member.startDate],
      [
        'Capacity',
        member.capacityMinutesPerWeek ? `${minutesToHours(member.capacityMinutesPerWeek)} hours a week` : undefined,
      ],
    ];
    return (
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd>{value || '—'}</dd>
          </div>
        ))}
      </dl>
    );
  }

  const onSubmit = form.handleSubmit(async (submitted) => {
    setStatus({ kind: 'idle' });
    try {
      await update({
        memberId: member.id,
        name: submitted.name,
        title: submitted.title || undefined,
        employmentType: submitted.employmentType,
        phone: submitted.phone || undefined,
        whatsapp: submitted.whatsapp || undefined,
        timezone: submitted.timezone,
        skills: splitSkills(submitted.skills),
        startDate: submitted.startDate || undefined,
        capacityMinutesPerWeek: hoursToMinutes(submitted.capacityHours),
      });
      form.reset(form.getValues());
      setStatus({ kind: 'saved' });
    } catch (error) {
      setStatus({ kind: 'error', message: errorMessage(error) });
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="profile-name" label="Name" error={errors.name?.message}>
          {(field) => <Input {...field} {...form.register('name')} />}
        </FormField>
        <FormField id="profile-title" label="Title" error={errors.title?.message}>
          {(field) => <Input {...field} {...form.register('title')} />}
        </FormField>
        <FormField id="profile-employment" label="Employment" error={errors.employmentType?.message}>
          {(field) => (
            <NativeSelect {...field} {...form.register('employmentType')}>
              <option value="employee">Employee</option>
              <option value="contractor">Contractor</option>
            </NativeSelect>
          )}
        </FormField>
        <FormField id="profile-start" label="Start date" error={errors.startDate?.message}>
          {(field) => <Input {...field} {...form.register('startDate')} type="date" />}
        </FormField>
        <FormField id="profile-phone" label="Phone" error={errors.phone?.message}>
          {(field) => <Input {...field} {...form.register('phone')} type="tel" inputMode="tel" />}
        </FormField>
        <FormField id="profile-whatsapp" label="WhatsApp" error={errors.whatsapp?.message}>
          {(field) => <Input {...field} {...form.register('whatsapp')} type="tel" inputMode="tel" />}
        </FormField>
        <FormField id="profile-timezone" label="Timezone" error={errors.timezone?.message}>
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
        <FormField
          id="profile-capacity"
          label="Capacity (hours a week)"
          help="Used for capacity planning"
          error={errors.capacityHours?.message}
        >
          {(field) => <Input {...field} {...form.register('capacityHours')} inputMode="decimal" />}
        </FormField>
      </div>
      <FormField id="profile-skills" label="Skills" help="Separate with commas" error={errors.skills?.message}>
        {(field) => <Input {...field} {...form.register('skills')} />}
      </FormField>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="submit" disabled={!isDirty || isSubmitting}>
          {isSubmitting ? 'Saving…' : 'Save profile'}
        </Button>
        <SaveStatus state={status} />
      </div>
    </form>
  );
}
