'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { ProjectFormDialog } from '@/components/projects/project-form-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { type Currency } from '@/convex/lib/money';
import { errorMessage } from '@/lib/convex-error';

// Winning a deal (06-projects.md; 05-crm.md, Deals). A deal is only won with its project: either a new one, from a
// template or blank, or one of the client's projects that no other deal has won.

export type WinnableDeal = {
  id: Id<'deals'>;
  title: string;
  clientId: Id<'clients'>;
  currency: Currency;
  valueMinor: number;
};

export function WinDealDialog({
  deal,
  canCreateProject,
  canPickManager,
  open,
  onOpenChange,
  onWon,
}: {
  deal: WinnableDeal;
  /** projects.create: only then can the deal be won with a new project. */
  canCreateProject: boolean;
  /** team.view: only then can the new project's manager be someone else. */
  canPickManager: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onWon?: (projectId: Id<'projects'>) => void;
}) {
  const projects = useQuery(api.projects.list, open ? { clientId: deal.clientId, status: 'open' } : 'skip');
  const winWithExisting = useMutation(api.projects.winDealWithExistingProject);
  const [choice, setChoice] = useState(canCreateProject ? 'new' : '');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <>
      <Dialog
        open={open && !creating}
        onOpenChange={(next) => {
          onOpenChange(next);
          setError(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Mark {deal.title} as won</DialogTitle>
            <DialogDescription>
              A won deal becomes a project. Create one now, or link a project this client already has.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="win-deal-project">Project</Label>
            <NativeSelect
              id="win-deal-project"
              value={choice}
              disabled={!projects}
              onChange={(event) => setChoice(event.target.value)}
            >
              {canCreateProject && <option value="new">Create a new project</option>}
              {!canCreateProject && <option value="">Choose a project</option>}
              {projects?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.code} · {project.name}
                </option>
              ))}
            </NativeSelect>
            {projects?.length === 0 && !canCreateProject && (
              <p className="text-sm text-muted-foreground">
                This client has no open project, and your role cannot create one.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              disabled={saving || !choice}
              onClick={async () => {
                if (choice === 'new') {
                  setCreating(true);
                  return;
                }
                setSaving(true);
                setError(null);
                try {
                  const projectId = await winWithExisting({ dealId: deal.id, projectId: choice as Id<'projects'> });
                  onOpenChange(false);
                  onWon?.(projectId);
                } catch (caught) {
                  setError(errorMessage(caught));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Saving…' : choice === 'new' ? 'Continue' : 'Win the deal'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ProjectFormDialog
        deal={deal}
        canPickManager={canPickManager}
        open={creating}
        onOpenChange={(next) => {
          setCreating(next);
          if (!next) onOpenChange(false);
        }}
        onSaved={(projectId) => {
          setCreating(false);
          onOpenChange(false);
          onWon?.(projectId);
        }}
      />
    </>
  );
}
