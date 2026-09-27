'use client';

import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ConfirmDialog } from '@/components/app/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RevealPanel } from '@/components/vault/reveal-panel';
import { VaultItemEditForm, VaultRotateForm } from '@/components/vault/vault-item-form';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { formatMoment } from '@/lib/support-display';
import {
  rotationDue,
  VAULT_ACCESS_LABEL,
  VAULT_KIND_LABEL,
  VAULT_STATUS_LABEL,
  type VaultKind,
} from '@/lib/vault-display';

// One credential (10-vault.md). The page shows everything about it except the value, which is asked for separately and
// taken away again. The history below is the access log: who has read this, and who was turned away.

function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}

export function VaultItem({ itemId, canManage }: { itemId: Id<'vaultItems'>; canManage: boolean }) {
  const item = useQuery(api.vaultData.get, { itemId });
  const setStatus = useMutation(api.vaultData.setStatus);
  const remove = useMutation(api.vaultData.remove);
  const router = useRouter();

  if (item === undefined) return <p className="text-muted-foreground">Loading…</p>;
  // A refusal and a missing item read the same, deliberately: see canSeeItem in convex/lib/vault.ts.
  if (item === null) {
    return (
      <div className="space-y-4">
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">This item is not available to you.</p>
        <Button variant="outline" asChild>
          <Link href="/vault">
            <ArrowLeft aria-hidden />
            Back to the vault
          </Link>
        </Button>
      </div>
    );
  }

  const due = rotationDue(item.rotateByDate, today());
  const archived = item.status === 'archived';

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-2">
          <Link href="/vault">
            <ArrowLeft aria-hidden />
            Vault
          </Link>
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{item.label}</h1>
            <p className="text-muted-foreground">
              {VAULT_KIND_LABEL[item.kind as VaultKind]} ·{' '}
              <Link href={`/crm/clients/${item.clientId}`} className="underline-offset-4 hover:underline">
                {item.clientName}
              </Link>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {item.status !== 'active' && <Badge variant="outline">{VAULT_STATUS_LABEL[item.status]}</Badge>}
            {due && <Badge variant={due.tone === 'danger' ? 'destructive' : 'secondary'}>{due.label}</Badge>}
            {item.submittedByKind === 'client' && <Badge variant="outline">Submitted by the client</Badge>}
          </div>
        </div>
      </div>

      {archived ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          This item is archived. Restore it to reveal or change it.
        </p>
      ) : (
        <RevealPanel itemId={item.id} />
      )}

      <dl className="grid gap-4 sm:grid-cols-2">
        {item.url && (
          <div>
            <dt className="text-sm text-muted-foreground">Where it is used</dt>
            <dd className="break-all">{item.url}</dd>
          </div>
        )}
        <div>
          <dt className="text-sm text-muted-foreground">Who can reveal it</dt>
          <dd>
            {item.projectId
              ? 'Everyone on the project, and anyone who can see the whole vault'
              : 'Only people who can see the whole vault'}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Username</dt>
          <dd>{item.hasUsername ? 'Kept, and encrypted' : 'None'}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Notes</dt>
          <dd>{item.hasNotes ? 'Kept, and encrypted' : 'None'}</dd>
        </div>
        {item.lastRotatedAt !== undefined && (
          <div>
            <dt className="text-sm text-muted-foreground">Last rotated</dt>
            <dd>{formatMoment(item.lastRotatedAt)}</dd>
          </div>
        )}
        <div>
          <dt className="text-sm text-muted-foreground">Encryption key</dt>
          <dd>Version {item.keyVersion}</dd>
        </div>
      </dl>

      {canManage && (
        <div className="flex flex-wrap gap-2 border-t pt-6">
          {!archived && (
            <>
              <VaultItemEditForm
                item={item}
                trigger={
                  <Button variant="outline">
                    <Pencil aria-hidden />
                    Change details
                  </Button>
                }
              />
              <VaultRotateForm
                item={item}
                trigger={
                  <Button variant="outline">
                    <RotateCcw aria-hidden />
                    Rotate
                  </Button>
                }
              />
            </>
          )}
          {item.status === 'active' && (
            <ConfirmDialog
              trigger={<Button variant="outline">Mark handed over</Button>}
              title={`Hand over ${item.label}?`}
              description="This records that the client holds this credential now. Unbuilt's copy still opens, because it is the record of what was handed over."
              confirmLabel="Mark handed over"
              onConfirm={async () => await setStatus({ itemId: item.id, status: 'handed_over' })}
            />
          )}
          {archived ? (
            <ConfirmDialog
              trigger={<Button variant="outline">Restore</Button>}
              title={`Restore ${item.label}?`}
              description="It goes back into the vault's lists, and can be revealed and changed again."
              confirmLabel="Restore it"
              onConfirm={async () => await setStatus({ itemId: item.id, status: 'active' })}
            />
          ) : (
            <ConfirmDialog
              trigger={<Button variant="outline">Archive</Button>}
              title={`Archive ${item.label}?`}
              description="It leaves the vault's lists and cannot be changed, but it is not deleted and can be restored."
              confirmLabel="Archive it"
              onConfirm={async () => await setStatus({ itemId: item.id, status: 'archived' })}
            />
          )}
          <ConfirmDialog
            trigger={
              <Button variant="destructive">
                <Trash2 aria-hidden />
                Delete
              </Button>
            }
            title={`Delete ${item.label}?`}
            description="This removes the encrypted value, which is the only copy Unbuilt has. The record of who read it is kept. This cannot be undone."
            confirmLabel="Delete it"
            onConfirm={async () => {
              await remove({ itemId: item.id });
              router.push('/vault');
            }}
          />
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Who has read this</h2>
        {item.history.length === 0 ? (
          <p className="text-muted-foreground">Nobody has opened it yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {item.history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                <span>
                  {entry.memberName} {VAULT_ACCESS_LABEL[entry.action]}
                  {entry.reason && <span className="text-muted-foreground"> — {entry.reason}</span>}
                </span>
                <span className="text-sm text-muted-foreground">{formatMoment(entry.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
