'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from 'convex/react';
import { type ReactNode, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { FormField } from '@/components/settings/form-field';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { TYPE_LABELS } from '@/convex/lib/timeOffFormat';
import { errorMessage } from '@/lib/convex-error';

/** Public holidays apply automatically, so nobody requests them. */
const REQUESTABLE = ['annual', 'sick', 'unpaid', 'other'] as const;

export const timeOffSchema = z
  .object({
    memberId: z.string(),
    type: z.enum(REQUESTABLE),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a start date'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose an end date'),
    halfDay: z.boolean(),
    note: z.string().trim().max(500, 'Keep the note under 500 characters'),
  })
  .refine((values) => values.endDate === '' || values.endDate >= values.startDate, {
    path: ['endDate'],
    message: 'The end date must be on or after the start date',
  });

type Values = z.infer<typeof timeOffSchema>;

/**
 * Request your own time off, or, with `members`, record it for someone else as an approver (approved at once).
 */
export function TimeOffDialog({
  trigger,
  members,
  today,
}: {
  trigger: ReactNode;
  members?: { id: Id<'teamMembers'>; name: string }[];
  today: string;
}) {
  const recording = members !== undefined;
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const request = useMutation(api.timeOff.request);
  const record = useMutation(api.timeOff.record);
  const defaults: Values = {
    memberId: '',
    type: recording ? 'sick' : 'annual',
    startDate: today,
    endDate: today,
    halfDay: false,
    note: '',
  };
  const form = useForm<Values>({
    resolver: zodResolver(
      recording
        ? timeOffSchema.refine((v) => v.memberId !== '', { path: ['memberId'], message: 'Choose a team member' })
        : timeOffSchema,
    ),
    defaultValues: defaults,
  });
  const { errors, isSubmitting } = form.formState;
  const [startDate, endDate] = useWatch({ control: form.control, name: ['startDate', 'endDate'] });
  const singleDay = startDate !== '' && startDate === endDate;

  const onSubmit = form.handleSubmit(async ({ memberId, note, halfDay, ...values }) => {
    setServerError(null);
    const args = { ...values, halfDay: singleDay && halfDay, note: note || undefined };
    try {
      if (recording) {
        await record({ ...args, memberId: memberId as Id<'teamMembers'> });
      } else {
        await request(args);
      }
      form.reset(defaults);
      setOpen(false);
    } catch (error) {
      setServerError(errorMessage(error));
    }
  });

  const title = recording ? 'Record time off' : 'Request time off';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setServerError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">{title}</DialogTitle>
          <DialogDescription>
            {recording
              ? 'For someone who cannot request it themselves, such as sick leave phoned in. It is approved straight away and they are notified.'
              : 'An approver is notified. Weekends and public holidays inside your dates do not count.'}
          </DialogDescription>
        </DialogHeader>
        <form id="time-off-form" onSubmit={onSubmit} noValidate className="space-y-4">
          {recording && (
            <FormField id="time-off-member" label="Team member" error={errors.memberId?.message}>
              {(field) => (
                <NativeSelect {...field} {...form.register('memberId')}>
                  <option value="">Choose who is off</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </FormField>
          )}
          <FormField id="time-off-type" label="Type" error={errors.type?.message}>
            {(field) => (
              <NativeSelect {...field} {...form.register('type')}>
                {REQUESTABLE.map((type) => (
                  <option key={type} value={type}>
                    {TYPE_LABELS[type]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="time-off-start" label="First day" error={errors.startDate?.message}>
              {(field) => (
                <Input
                  {...field}
                  type="date"
                  {...form.register('startDate', {
                    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
                      const end = form.getValues('endDate');
                      if (!end || end < event.target.value) form.setValue('endDate', event.target.value);
                    },
                  })}
                />
              )}
            </FormField>
            <FormField id="time-off-end" label="Last day" error={errors.endDate?.message}>
              {(field) => <Input {...field} type="date" min={startDate} {...form.register('endDate')} />}
            </FormField>
          </div>
          {singleDay && (
            <div className="flex items-center gap-2">
              <Controller
                control={form.control}
                name="halfDay"
                render={({ field }) => (
                  <Checkbox
                    id="time-off-half-day"
                    checked={field.value}
                    onCheckedChange={(checked) => field.onChange(checked === true)}
                  />
                )}
              />
              <Label htmlFor="time-off-half-day" className="font-normal">
                Half day
              </Label>
            </div>
          )}
          <FormField
            id="time-off-note"
            label="Note (optional)"
            help="Only the person who is off and approvers see the type and note."
            error={errors.note?.message}
          >
            {(field) => <Textarea {...field} {...form.register('note')} rows={3} />}
          </FormField>
          {serverError && (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form="time-off-form" disabled={isSubmitting}>
            {isSubmitting ? 'Saving…' : recording ? 'Record time off' : 'Send request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
