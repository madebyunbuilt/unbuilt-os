'use client';

import { useMutation, useQuery } from 'convex/react';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { ToneBadge } from '@/components/team/status-badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api } from '@/convex/_generated/api';
import { type DocumentType, TYPE_LABELS } from '@/convex/lib/documentBlocks';
import { errorMessage } from '@/lib/convex-error';

// Document templates, grouped by type (07-documents-and-esign.md). One per type is the default a new document starts
// from. Templates are retired, never deleted; documents made from one keep their own copy of its wording.

export function TemplateList() {
  const [showRetired, setShowRetired] = useState(false);
  const templates = useQuery(api.documentTemplates.list, { includeRetired: showRetired });
  const setDefault = useMutation(api.documentTemplates.setDefault);
  const setActive = useMutation(api.documentTemplates.setActive);
  const [error, setError] = useState<string | null>(null);

  const types = [...new Set((templates ?? []).map((template) => template.type as DocumentType))];

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Switch id="show-retired-templates" checked={showRetired} onCheckedChange={setShowRetired} />
          <Label htmlFor="show-retired-templates" className="font-normal">
            Show retired templates
          </Label>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Button variant="outline" asChild>
            <Link href="/settings/clauses">The clause library</Link>
          </Button>
          <Button asChild>
            <Link href="/settings/document-templates/new">
              <Plus aria-hidden />
              New template
            </Link>
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-attention p-3 text-sm text-attention-foreground">
          {error}
        </p>
      )}

      {templates === undefined ? (
        <p className="text-muted-foreground">Loading templates…</p>
      ) : templates.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-muted-foreground">
          No templates yet. Running the seed adds one for every type.
        </p>
      ) : (
        types.map((type) => (
          <section key={type} className="space-y-2">
            <h3 className="font-medium">{TYPE_LABELS[type]}</h3>
            <ul className="space-y-2">
              {templates
                .filter((template) => template.type === type)
                .map((template) => (
                  <li key={template.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
                    <div className="min-w-0">
                      <Link
                        href={`/settings/document-templates/${template.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {template.name}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        Version {template.version} · {template.blocks.length} blocks
                        {template.description ? ` · ${template.description}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                      {template.isDefault && <ToneBadge label="Default" tone="built" />}
                      {template.requiresLegalReview && <ToneBadge label="Needs legal review" tone="attention" />}
                      {!template.active && <ToneBadge label="Retired" tone="muted" />}
                      {template.active && !template.isDefault && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void run(() => setDefault({ templateId: template.id }))}
                        >
                          Make default
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void run(() => setActive({ templateId: template.id, active: !template.active }))}
                      >
                        {template.active ? 'Retire' : 'Bring back'}
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
