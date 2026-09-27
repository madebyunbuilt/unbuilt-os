'use client';

import { useAction, useMutation, useQuery } from 'convex/react';
import { type ReactNode, useState } from 'react';
import { FormDialog } from '@/components/app/form-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { VAULT_KIND_LABEL, VAULT_KINDS, type VaultKind } from '@/lib/vault-display';

// Adding a credential, changing what is written about one, and rotating the value itself (10-vault.md). Three dialogs
// rather than one form: what a rotation does is not what an edit does, and a screen that blurred them would invite
// somebody to retype a secret in order to fix a typo in its label.

type Item = NonNullable<typeof api.vaultData.get._returnType>;

/** Adding one. The secret is asked for once and goes straight to the action that seals it. */
export function VaultItemForm({
  clientId,
  projectId,
  canSeeAll,
  trigger,
}: {
  clientId?: Id<'clients'>;
  projectId?: Id<'projects'>;
  /** Whether this person holds `vault.view.all`, which decides whether they could open a client-level item. */
  canSeeAll: boolean;
  trigger: ReactNode;
}) {
  const create = useAction(api.vault.create);
  const clients = useQuery(api.clients.list, clientId ? 'skip' : {});
  const [client, setClient] = useState<string>(clientId ?? '');
  const projects = useQuery(api.projects.list, client ? { clientId: client as Id<'clients'> } : 'skip');
  const [project, setProject] = useState<string>(projectId ?? '');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<VaultKind>('login');
  const [url, setUrl] = useState('');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [notes, setNotes] = useState('');
  const [rotateByDate, setRotateByDate] = useState('');

  return (
    <FormDialog
      trigger={trigger}
      title="Add a credential"
      description="It is encrypted before it is written down. Nobody can read it back out of the database, including Unbuilt."
      submitLabel="Add it"
      canSubmit={Boolean(client) && label.trim().length > 0 && secret.trim().length > 0}
      onSubmit={async () => {
        await create({
          clientId: client as Id<'clients'>,
          projectId: project ? (project as Id<'projects'>) : undefined,
          label,
          kind,
          url: url.trim() ? url : undefined,
          username: username.trim() ? username : undefined,
          secret,
          notes: notes.trim() ? notes : undefined,
          rotateByDate: rotateByDate || undefined,
        });
        setLabel('');
        setUrl('');
        setUsername('');
        setSecret('');
        setNotes('');
        setRotateByDate('');
      }}
    >
      {!clientId && (
        <div className="space-y-2">
          <Label htmlFor="vault-client">Client</Label>
          <NativeSelect
            id="vault-client"
            value={client}
            onChange={(event) => {
              setClient(event.target.value);
              setProject('');
            }}
          >
            <option value="">Choose a client</option>
            {(clients ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.displayName}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      {!projectId && (
        <div className="space-y-2">
          <Label htmlFor="vault-project">Project</Label>
          <NativeSelect id="vault-project" value={project} onChange={(event) => setProject(event.target.value)}>
            <option value="">The client as a whole</option>
            {(projects ?? []).map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </NativeSelect>
          {/* Scope is the whole of who can see this, so it is said here rather than left to be discovered. */}
          <p className="text-sm text-muted-foreground">
            On a project, everyone on that project can reveal it, plus anyone who can see the whole vault. Against the
            client as a whole, only people who can see the whole vault — which is fewer people, not more.
          </p>
          {/* The trap this closes: vault.manage lets somebody add an item that vault.view.assigned cannot then open. */}
          {!canSeeAll && !project && (
            <p className="text-sm text-destructive">
              You can see vault items on your own projects, so you would not be able to open this one again yourself.
              Choose a project if you need to.
            </p>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="vault-label">Label</Label>
          <Input
            id="vault-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Hosting login"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vault-kind">Kind</Label>
          <NativeSelect id="vault-kind" value={kind} onChange={(event) => setKind(event.target.value as VaultKind)}>
            {VAULT_KINDS.map((key) => (
              <option key={key} value={key}>
                {VAULT_KIND_LABEL[key]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="vault-url">Where it is used</Label>
        <Input
          id="vault-url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://dashboard.example.com"
        />
        <p className="text-sm text-muted-foreground">Stored as written, so it can be listed and searched.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="vault-username">Username</Label>
        <Input id="vault-username" value={username} onChange={(event) => setUsername(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="vault-secret">Secret</Label>
        <Textarea
          id="vault-secret"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          rows={3}
          placeholder="Password, key or file contents"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="vault-notes">Notes</Label>
        <Textarea id="vault-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
        <p className="text-sm text-muted-foreground">Encrypted too, so anything sensitive can go here.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="vault-rotate">Rotate by</Label>
        <Input
          id="vault-rotate"
          type="date"
          value={rotateByDate}
          onChange={(event) => setRotateByDate(event.target.value)}
        />
        <p className="text-sm text-muted-foreground">
          Optional. Unbuilt will remind the project manager a week before, and again on the day.
        </p>
      </div>
    </FormDialog>
  );
}

/** Changing what is written about an item. The secret is not here: it is not readable, so it cannot be edited in place. */
export function VaultItemEditForm({ item, trigger }: { item: Item; trigger: ReactNode }) {
  const update = useMutation(api.vaultData.update);
  const projects = useQuery(api.projects.list, { clientId: item.clientId });
  const [label, setLabel] = useState(item.label);
  const [kind, setKind] = useState<VaultKind>(item.kind as VaultKind);
  const [url, setUrl] = useState(item.url ?? '');
  const [project, setProject] = useState<string>(item.projectId ?? '');
  const [rotateByDate, setRotateByDate] = useState(item.rotateByDate ?? '');

  return (
    <FormDialog
      trigger={trigger}
      title={`Change ${item.label}`}
      description="The secret itself is changed separately, because changing it means changing it where it is used."
      submitLabel="Save"
      canSubmit={label.trim().length > 0}
      onSubmit={async () => {
        await update({
          itemId: item.id,
          label,
          kind,
          url,
          // Null is how this says "off the project" and "no date"; leaving the field out would mean "unchanged".
          projectId: project ? (project as Id<'projects'>) : null,
          rotateByDate: rotateByDate || null,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="edit-label">Label</Label>
          <Input id="edit-label" value={label} onChange={(event) => setLabel(event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-kind">Kind</Label>
          <NativeSelect id="edit-kind" value={kind} onChange={(event) => setKind(event.target.value as VaultKind)}>
            {VAULT_KINDS.map((key) => (
              <option key={key} value={key}>
                {VAULT_KIND_LABEL[key]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-url">Where it is used</Label>
        <Input id="edit-url" value={url} onChange={(event) => setUrl(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-project">Project</Label>
        <NativeSelect id="edit-project" value={project} onChange={(event) => setProject(event.target.value)}>
          <option value="">The client as a whole</option>
          {(projects ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </NativeSelect>
        <p className="text-sm text-muted-foreground">Moving it changes who can reveal it.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="edit-rotate">Rotate by</Label>
        <Input
          id="edit-rotate"
          type="date"
          value={rotateByDate}
          onChange={(event) => setRotateByDate(event.target.value)}
        />
      </div>
    </FormDialog>
  );
}

/** Rotating the value, once it has been changed wherever the credential actually lives. */
export function VaultRotateForm({ item, trigger }: { item: Item; trigger: ReactNode }) {
  const updateSecret = useAction(api.vault.updateSecret);
  const [secret, setSecret] = useState('');
  const [username, setUsername] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <FormDialog
      trigger={trigger}
      title={`Rotate ${item.label}`}
      description="Change it where the credential lives first, then record the new value here. The old one is replaced, not kept."
      submitLabel="Record the new secret"
      canSubmit={secret.trim().length > 0}
      onSubmit={async () => {
        await updateSecret({
          itemId: item.id,
          secret,
          username: username.trim() ? username : undefined,
          notes: notes.trim() ? notes : undefined,
        });
        setSecret('');
        setUsername('');
        setNotes('');
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="rotate-secret">New secret</Label>
        <Textarea id="rotate-secret" value={secret} onChange={(event) => setSecret(event.target.value)} rows={3} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="rotate-username">Username</Label>
        <Input
          id="rotate-username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={item.hasUsername ? 'Leave empty to remove it' : ''}
        />
        {/* Said plainly, because the old values cannot be shown back and a blank field looks like "unchanged". */}
        <p className="text-sm text-muted-foreground">
          The username and notes are replaced along with the secret. Anything left empty is removed.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="rotate-notes">Notes</Label>
        <Textarea id="rotate-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
      </div>
    </FormDialog>
  );
}
