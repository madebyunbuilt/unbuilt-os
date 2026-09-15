'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
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
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { SERVICE_LABELS } from '@/convex/lib/enquiries';
import { errorMessage } from '@/lib/convex-error';
import { ENQUIRY_SOURCE_LABELS, enquiryStatus } from '@/lib/crm-display';

type View = 'open' | 'converted' | 'spam' | 'closed';

const VIEWS: { value: View; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'converted', label: 'Converted' },
  { value: 'spam', label: 'Spam' },
  { value: 'closed', label: 'Closed' },
];

const received = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function EnquiryList({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [view, setView] = useState<View>('open');
  const enquiries = useQuery(api.enquiries.list, { view });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-1">
          {VIEWS.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={view === option.value ? 'default' : 'outline'}
              aria-pressed={view === option.value}
              onClick={() => setView(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        {canManage && (
          <div className="sm:ml-auto">
            <ManualEnquiryDialog onSaved={(id) => router.push(`/crm/enquiries/${id}`)} />
          </div>
        )}
      </div>

      {enquiries === undefined ? (
        <p className="text-muted-foreground">Loading enquiries…</p>
      ) : enquiries.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          {view === 'open' ? 'No enquiries waiting.' : 'Nothing here.'}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border" aria-label="Enquiries">
          {enquiries.map((enquiry) => (
            <li key={enquiry.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <Link href={`/crm/enquiries/${enquiry.id}`} className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{enquiry.name}</span>
                  {enquiry.company && <span className="text-muted-foreground">{enquiry.company}</span>}
                  <ToneBadge {...enquiryStatus(enquiry.status)} />
                  {enquiry.existingClient && (
                    <ToneBadge label={`Client: ${enquiry.existingClient.name}`} tone="built" />
                  )}
                </span>
                <span className="block text-sm text-muted-foreground">
                  {enquiry.services.map((service) => service.label).join(', ')}
                  {enquiry.budget ? ` · ${enquiry.budget}` : ''}
                </span>
              </Link>
              <span className="text-sm text-muted-foreground sm:text-right">
                {ENQUIRY_SOURCE_LABELS[enquiry.source]} · {received.format(enquiry.receivedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ManualEnquiryDialog({ onSaved }: { onSaved: (id: Id<'enquiries'>) => void }) {
  const create = useMutation(api.enquiries.createManual);
  const [open, setOpen] = useState(false);
  const blank = {
    source: 'email' as 'manual' | 'email' | 'referral',
    name: '',
    email: '',
    company: '',
    about: '',
    services: [] as string[],
  };
  const [values, setValues] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const id = await create({
        source: values.source,
        name: values.name,
        email: values.email,
        company: values.company || undefined,
        about: values.about || undefined,
        services: values.services,
      });
      setOpen(false);
      onSaved(id);
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
        if (next) setValues(blank);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          Add enquiry
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Add an enquiry</DialogTitle>
          <DialogDescription>
            For enquiries that came by email, referral or in person. Website enquiries arrive on their own.
          </DialogDescription>
        </DialogHeader>
        <form
          id="manual-enquiry-form"
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="manual-enquiry-source">How it came in</Label>
            <NativeSelect
              id="manual-enquiry-source"
              value={values.source}
              onChange={(event) => setValues({ ...values, source: event.target.value as typeof values.source })}
            >
              <option value="email">Email</option>
              <option value="referral">Referral</option>
              <option value="manual">In person</option>
            </NativeSelect>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="manual-enquiry-name">Name</Label>
              <Input
                id="manual-enquiry-name"
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-enquiry-email">Email</Label>
              <Input
                id="manual-enquiry-email"
                type="email"
                value={values.email}
                onChange={(e) => setValues({ ...values, email: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="manual-enquiry-company">Company (optional)</Label>
            <Input
              id="manual-enquiry-company"
              value={values.company}
              onChange={(e) => setValues({ ...values, company: e.target.value })}
            />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Services</legend>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(SERVICE_LABELS).map(([slug, label]) => (
                <div key={slug} className="flex items-center gap-2">
                  <Checkbox
                    id={`manual-enquiry-service-${slug}`}
                    checked={values.services.includes(slug)}
                    onCheckedChange={(checked) =>
                      setValues({
                        ...values,
                        services:
                          checked === true ? [...values.services, slug] : values.services.filter((s) => s !== slug),
                      })
                    }
                  />
                  <Label htmlFor={`manual-enquiry-service-${slug}`} className="font-normal">
                    {label}
                  </Label>
                </div>
              ))}
            </div>
          </fieldset>
          <div className="space-y-2">
            <Label htmlFor="manual-enquiry-about">What they need (optional)</Label>
            <Textarea
              id="manual-enquiry-about"
              rows={3}
              value={values.about}
              onChange={(e) => setValues({ ...values, about: e.target.value })}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="manual-enquiry-form"
            disabled={saving || !values.name.trim() || !values.email.trim()}
          >
            {saving ? 'Adding…' : 'Add enquiry'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
