'use client';

import { useAction, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '@/components/app/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { formatMoment } from '@/lib/support-display';
import { VAULT_KIND_LABEL, VAULT_KINDS, type VaultKind } from '@/lib/vault-display';

// Handing a credential to the studio (10-vault.md, Access). A client sends, and never reads: what comes back is the
// list of what they have sent, by label and date. There is nothing on this page that could show a value.

function SubmitForm() {
  const submit = useAction(api.vault.submitFromPortal);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<VaultKind>('login');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <FormDialog
      trigger={
        <Button>
          <Plus aria-hidden />
          Send a credential
        </Button>
      }
      title="Send a credential"
      description="It is encrypted the moment it arrives, and only the people working on your projects can open it. Please do not send credentials by email or chat."
      submitLabel="Send it"
      canSubmit={label.trim().length > 0 && secret.trim().length > 0}
      onSubmit={async () => {
        await submit({
          label,
          kind,
          url: url.trim() ? url : undefined,
          username: username.trim() ? username : undefined,
          secret,
          notes: notes.trim() ? notes : undefined,
        });
        setLabel('');
        setUrl('');
        setUsername('');
        setSecret('');
        setNotes('');
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="portal-vault-label">What is it for</Label>
          <Input
            id="portal-vault-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Domain registrar login"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="portal-vault-kind">Kind</Label>
          <NativeSelect
            id="portal-vault-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as VaultKind)}
          >
            {VAULT_KINDS.map((key) => (
              <option key={key} value={key}>
                {VAULT_KIND_LABEL[key]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="portal-vault-url">Where it is used</Label>
        <Input
          id="portal-vault-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://registrar.example.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="portal-vault-username">Username</Label>
        <Input id="portal-vault-username" value={username} onChange={(event) => setUsername(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="portal-vault-secret">Password or key</Label>
        <Textarea
          id="portal-vault-secret"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          rows={3}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="portal-vault-notes">Anything else we should know</Label>
        <Textarea id="portal-vault-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
      </div>
    </FormDialog>
  );
}

export function PortalVault() {
  const items = useQuery(api.vaultData.portalList, {});

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-6 lg:py-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Credentials</h1>
        <p className="text-muted-foreground">
          Somewhere safer than email for the logins Unbuilt needs. Anything you send is encrypted straight away, and
          every time somebody at Unbuilt opens one it is recorded.
        </p>
      </div>

      <SubmitForm />

      <section className="space-y-3">
        <h2 className="text-lg font-medium">What you have sent</h2>
        {items === undefined ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="rounded-md border border-dashed p-6 text-muted-foreground">
            Nothing yet. Anything you send appears here, by name and date. Values are never shown again, including to
            you — if you lose one, change it where it lives and send the new one.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                <span className="min-w-0">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-muted-foreground"> · {VAULT_KIND_LABEL[item.kind as VaultKind]}</span>
                </span>
                <span className="flex items-center gap-2 text-sm text-muted-foreground">
                  {item.status === 'handed_over' && <Badge variant="outline">Handed back</Badge>}
                  Sent {formatMoment(item.submittedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
