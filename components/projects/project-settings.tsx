'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';

// Project settings (06-projects.md, Projects): where the work lives and which SLA policy applies. Name, dates, budget
// and manager are edited from the header; status changes are on the header too.

const LINK_FIELDS = [
  { key: 'repo', label: 'Repository', placeholder: 'https://github.com/…' },
  { key: 'staging', label: 'Staging', placeholder: 'https://staging…' },
  { key: 'production', label: 'Production', placeholder: 'https://…' },
  { key: 'design', label: 'Design', placeholder: 'https://figma.com/…' },
] as const;

type Links = Record<(typeof LINK_FIELDS)[number]['key'], string>;

export function ProjectSettings({ projectId, permissions }: { projectId: Id<'projects'>; permissions: string[] }) {
  const project = useQuery(api.projects.get, { projectId });
  const policies = useQuery(api.clients.slaPolicyOptions, permissions.includes('clients.view') ? {} : 'skip');
  const update = useMutation(api.projects.update);
  const [links, setLinks] = useState<Links | null>(null);
  const [slaPolicyId, setSlaPolicyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  if (project === undefined) return <p className="text-muted-foreground">Loading settings…</p>;
  if (!permissions.includes('projects.update')) {
    return <p className="text-muted-foreground">Your role cannot change this project&rsquo;s settings.</p>;
  }

  const current: Links = links ?? {
    repo: project.links.repo ?? '',
    staging: project.links.staging ?? '',
    production: project.links.production ?? '',
    design: project.links.design ?? '',
  };
  const sla = slaPolicyId ?? project.slaPolicyId ?? '';

  return (
    <form
      className="max-w-xl space-y-6"
      aria-label="Project settings"
      onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        setSaved(false);
        try {
          await update({
            projectId,
            name: project.name,
            type: project.type,
            billingModel: project.billingModel,
            currency: project.currency,
            budgetMinor: project.budgetMinor,
            startDate: project.startDate,
            dueDate: project.dueDate,
            managerMemberId: project.managerMemberId,
            description: project.description,
            slaPolicyId: (sla || undefined) as Id<'slaPolicies'> | undefined,
            links: {
              repo: current.repo || undefined,
              staging: current.staging || undefined,
              production: current.production || undefined,
              design: current.design || undefined,
            },
          });
          setSaved(true);
        } catch (caught) {
          setError(errorMessage(caught));
        } finally {
          setSaving(false);
        }
      }}
    >
      <div className="space-y-4">
        <div>
          <h2 className="font-display text-xl font-bold">Links</h2>
          <p className="text-sm text-muted-foreground">Where the work lives. Shown on the overview.</p>
        </div>
        {LINK_FIELDS.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={`project-link-${field.key}`}>{field.label}</Label>
            <Input
              id={`project-link-${field.key}`}
              placeholder={field.placeholder}
              value={current[field.key]}
              onChange={(event) => setLinks({ ...current, [field.key]: event.target.value })}
            />
          </div>
        ))}
      </div>

      {policies && (
        <div className="space-y-2">
          <Label htmlFor="project-sla">SLA policy</Label>
          <NativeSelect id="project-sla" value={sla} onChange={(event) => setSlaPolicyId(event.target.value)}>
            <option value="">None</option>
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.name}
              </option>
            ))}
          </NativeSelect>
          <p className="text-sm text-muted-foreground">
            Response and resolution targets for this project&rsquo;s tickets.
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </Button>
        {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      </div>
    </form>
  );
}
