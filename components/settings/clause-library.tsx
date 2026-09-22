'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { VariableHelp } from '@/components/settings/variable-help';
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
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/convex/_generated/api';
import { errorMessage } from '@/lib/convex-error';

// The clause library (07-documents-and-esign.md, Templates and clauses). Rewording a clause raises its version; the
// documents already made keep the wording they copied in. A clause an active template still uses cannot be retired.

type Clause = (typeof api.clauses.list._returnType)[number];

export function ClauseLibrary() {
  const [showRetired, setShowRetired] = useState(false);
  const clauses = useQuery(api.clauses.list, { includeRetired: showRetired });
  const setActive = useMutation(api.clauses.setActive);
  const [error, setError] = useState<string | null>(null);

  const categories = [...new Set((clauses ?? []).map((clause) => clause.category))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch id="show-retired-clauses" checked={showRetired} onCheckedChange={setShowRetired} />
          <Label htmlFor="show-retired-clauses" className="font-normal">
            Show retired clauses
          </Label>
        </div>
        <div className="sm:ml-auto">
          <ClauseDialog
            trigger={
              <Button>
                <Plus aria-hidden />
                New clause
              </Button>
            }
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-attention p-3 text-sm text-attention-foreground">
          {error}
        </p>
      )}

      {clauses === undefined ? (
        <p className="text-muted-foreground">Loading clauses…</p>
      ) : clauses.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">No clauses yet.</p>
      ) : (
        categories.map((category) => (
          <section key={category} className="space-y-2">
            <h3 className="font-medium">{category}</h3>
            <ul className="space-y-2">
              {clauses
                .filter((clause) => clause.category === category)
                .map((clause) => (
                  <li key={clause.id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <p className="font-medium">{clause.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {clause.key} · version {clause.version}
                        {!clause.active && ' · retired'}
                      </p>
                      <div className="flex gap-1 sm:ml-auto">
                        <ClauseDialog
                          clause={clause}
                          trigger={
                            <Button variant="ghost" size="sm">
                              Edit
                            </Button>
                          }
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            setError(null);
                            try {
                              await setActive({ clauseId: clause.id, active: !clause.active });
                            } catch (caught) {
                              setError(errorMessage(caught));
                            }
                          }}
                        >
                          {clause.active ? 'Retire' : 'Bring back'}
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{clause.body}</p>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function ClauseDialog({ clause, trigger }: { clause?: Clause; trigger: ReactNode }) {
  const create = useMutation(api.clauses.create);
  const update = useMutation(api.clauses.update);
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(clause?.key ?? '');
  const [title, setTitle] = useState(clause?.title ?? '');
  const [category, setCategory] = useState(clause?.category ?? 'General');
  const [body, setBody] = useState(clause?.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = clause ? `clause-${clause.id}` : 'clause-new';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">{clause ? `Edit ${clause.title}` : 'New clause'}</DialogTitle>
          <DialogDescription>
            {clause
              ? 'Changing the wording makes version ' +
                (clause.version + 1) +
                '. Documents already made keep the wording they have.'
              : 'Templates refer to a clause by its key, so keep the key short and never reuse one.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id={formId}
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            try {
              if (clause) await update({ clauseId: clause.id, title, body, category });
              else await create({ key, title, body, category });
              setOpen(false);
              if (!clause) {
                setKey('');
                setTitle('');
                setBody('');
              }
            } catch (caught) {
              setError(errorMessage(caught));
            } finally {
              setSaving(false);
            }
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {!clause && (
              <div className="space-y-2">
                <Label htmlFor={`${formId}-key`}>Key</Label>
                <Input
                  id={`${formId}-key`}
                  placeholder="payment-terms"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={`${formId}-title`}>Title</Label>
              <Input id={`${formId}-title`} value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${formId}-category`}>Category</Label>
              <Input id={`${formId}-category`} value={category} onChange={(event) => setCategory(event.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${formId}-body`}>Wording</Label>
            <Textarea id={`${formId}-body`} rows={6} value={body} onChange={(event) => setBody(event.target.value)} />
          </div>
          <VariableHelp />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button type="submit" form={formId} disabled={saving || !title.trim() || !body.trim()}>
            {saving ? 'Saving…' : clause ? 'Save clause' : 'Add clause'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
