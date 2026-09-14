'use client';

import { useMutation } from 'convex/react';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';

export type ChecklistItem = { index: number; label: string; required: boolean; automatic: boolean; done: boolean };

export function OnboardingChecklist({
  memberId,
  items,
  editable,
}: {
  memberId: Id<'teamMembers'>;
  items: ChecklistItem[];
  editable: boolean;
}) {
  const setItem = useMutation(api.team.setChecklistItem);
  const addItem = useMutation(api.team.addChecklistItem);
  const removeItem = useMutation(api.team.removeChecklistItem);
  const [newLabel, setNewLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const done = items.filter((item) => item.done).length;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  async function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newLabel.trim()) return;
    await run(() => addItem({ memberId, label: newLabel, required: false }));
    setNewLabel('');
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {done} of {items.length} done
      </p>
      <ul className="divide-y rounded-lg border">
        {items.map((item) => {
          const id = `onboarding-${item.index}`;
          return (
            <li key={`${item.index}-${item.label}`} className="flex items-center gap-3 px-4 py-3">
              <Checkbox
                id={id}
                checked={item.done}
                disabled={!editable || item.automatic}
                onCheckedChange={(checked) =>
                  void run(() => setItem({ memberId, index: item.index, done: checked === true }))
                }
              />
              <Label htmlFor={id} className="flex-1 font-normal">
                {item.label}
                {item.required && <span className="sr-only"> (required)</span>}
              </Label>
              {item.automatic && <span className="text-xs text-muted-foreground">Automatic</span>}
              {item.required && !item.automatic && (
                <span aria-hidden className="text-xs text-muted-foreground">
                  Required
                </span>
              )}
              {editable && !item.automatic && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove “${item.label}”`}
                  onClick={() => void run(() => removeItem({ memberId, index: item.index }))}
                >
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {editable && (
        <form onSubmit={(event) => void onAdd(event)} className="flex gap-2">
          <Label htmlFor="onboarding-new" className="sr-only">
            New checklist item
          </Label>
          <Input
            id="onboarding-new"
            placeholder="Add an item, such as Laptop issued"
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={!newLabel.trim()}>
            Add
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
