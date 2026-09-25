'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { FormDialog } from '@/components/app/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';
import { formatDay } from '@/lib/crm-display';

// A client admin managing their own people (12-client-portal.md, Team). Everything here is about their own company:
// who can sign in, and which of them can approve and pay. The studio is not in the loop for any of it.

type Colleague = (typeof api.portalColleagues.list._returnType)[number];
type Role = 'client_admin' | 'client_member';

const ROLE_LABEL: Record<Role, string> = {
  client_admin: 'Admin — can approve and pay',
  client_member: 'Member — can see the work',
};

function RoleOptions() {
  return (
    <>
      <option value="client_admin">{ROLE_LABEL.client_admin}</option>
      <option value="client_member">{ROLE_LABEL.client_member}</option>
    </>
  );
}

/** Inviting somebody new, or letting in a contact Unbuilt already holds. */
function Invite({ colleague }: { colleague?: Colleague }) {
  const invite = useMutation(api.portalColleagues.invite);
  const [name, setName] = useState(colleague?.name ?? '');
  const [email, setEmail] = useState(colleague?.email ?? '');
  const [jobTitle, setJobTitle] = useState(colleague?.jobTitle ?? '');
  const [role, setRole] = useState<Role>('client_member');
  const known = colleague !== undefined;
  return (
    <FormDialog
      trigger={
        known ? (
          <Button variant="outline" size="sm">
            Give access
          </Button>
        ) : (
          <Button>Invite a colleague</Button>
        )
      }
      title={known ? `Give ${colleague.name} access` : 'Invite a colleague'}
      description="They get an email with a link that signs them in. Nobody else can use it."
      submitLabel={known ? 'Give access' : 'Send the invitation'}
      canSubmit={name.trim().length > 0 && email.trim().length > 0}
      onSubmit={() => invite({ name, email, jobTitle: jobTitle || undefined, role })}
    >
      <div className="space-y-2">
        <Label htmlFor="colleague-name">Name</Label>
        <Input
          id="colleague-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={known}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="colleague-email">Email</Label>
        <Input
          id="colleague-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={known}
          required
        />
      </div>
      {!known && (
        <div className="space-y-2">
          <Label htmlFor="colleague-job">Job title</Label>
          <Input id="colleague-job" value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} />
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="colleague-role">What they can do</Label>
        <NativeSelect id="colleague-role" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          <RoleOptions />
        </NativeSelect>
      </div>
    </FormDialog>
  );
}

function Row({ colleague, onError }: { colleague: Colleague; onError: (message: string | null) => void }) {
  const setRole = useMutation(api.portalColleagues.setRole);
  const revoke = useMutation(api.portalColleagues.revoke);
  const [saving, setSaving] = useState(false);

  async function change(role: Role) {
    setSaving(true);
    onError(null);
    try {
      await setRole({ contactId: colleague.id as Id<'contacts'>, role });
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="font-medium">
          {colleague.name}
          {colleague.isYou && <span className="ml-2 text-sm font-normal text-muted-foreground">you</span>}
        </p>
        <p className="truncate text-sm text-muted-foreground">
          {colleague.email}
          {colleague.jobTitle ? ` · ${colleague.jobTitle}` : ''}
          {colleague.hasAccess && colleague.invitedAt
            ? ` · invited ${formatDay(new Date(colleague.invitedAt).toISOString().slice(0, 10))}`
            : ''}
        </p>
      </div>

      {colleague.hasAccess ? (
        <div className="flex flex-wrap items-center gap-2">
          <NativeSelect
            aria-label={`What ${colleague.name} can do`}
            className="w-auto"
            value={colleague.role ?? 'client_member'}
            disabled={saving}
            onChange={(event) => change(event.target.value as Role)}
          >
            <RoleOptions />
          </NativeSelect>
          {!colleague.isYou && (
            <ConfirmDialog
              trigger={
                <Button variant="outline" size="sm">
                  Remove access
                </Button>
              }
              title={`Remove ${colleague.name}'s access`}
              description="They can no longer sign in. Unbuilt keeps them on file as somebody you worked with, so nothing already approved or signed changes."
              confirmLabel="Remove access"
              onConfirm={() => revoke({ contactId: colleague.id as Id<'contacts'> })}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">No access</span>
          <Invite colleague={colleague} />
        </div>
      )}
    </li>
  );
}

export function PortalColleagues() {
  const colleagues = useQuery(api.portalColleagues.list, {});
  const [error, setError] = useState<string | null>(null);
  if (colleagues === undefined) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground">
          Who at your company can sign in, and which of them can approve work and pay invoices.
        </p>
        <Invite />
      </div>
      {error && (
        <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <ul className="divide-y rounded-lg border">
        {colleagues.map((colleague) => (
          <Row key={colleague.id} colleague={colleague} onError={setError} />
        ))}
      </ul>
    </div>
  );
}
