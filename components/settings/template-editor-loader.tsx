'use client';

import { useQuery } from 'convex/react';
import { TemplateEditor } from '@/components/settings/template-editor';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';

/** Loads the template, then hands it to the editor so its fields start from what is saved. */
export function TemplateEditorLoader({ templateId }: { templateId: Id<'documentTemplates'> }) {
  const template = useQuery(api.documentTemplates.get, { templateId });
  if (template === undefined) return <p className="text-muted-foreground">Loading the template…</p>;
  if (template === null) return <p className="text-muted-foreground">That template does not exist.</p>;
  return <TemplateEditor key={`${template.id}:${template.version}`} template={template} />;
}
