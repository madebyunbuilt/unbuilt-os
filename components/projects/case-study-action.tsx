'use client';

import { useMutation, useQuery } from 'convex/react';
import { BookOpen } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { type Id } from '@/convex/_generated/dataModel';
import { errorMessage } from '@/lib/convex-error';

// Starting a case study from this project (13-cms-and-website.md, From project to case study). The spec's moment for
// this is handover completing, which lands in step 15; until then somebody asks for it here.
//
// Once one exists this becomes a link to it rather than a second button, because drafting again would hand back the
// same draft and a button that looks like it does something new should do something new.

export function CaseStudyAction({ projectId }: { projectId: Id<'projects'> }) {
  const existing = useQuery(api.cms.list, { table: 'works' });
  const draft = useMutation(api.caseStudy.draftFromProject);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const already = existing?.find((row) => row.projectId === projectId);

  if (already) {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link href={`/cms/works/${already.id}`}>
          <BookOpen aria-hidden />
          Its case study
        </Link>
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const { workId } = await draft({ projectId });
            router.push(`/cms/works/${workId}`);
          } catch (caught) {
            setError(errorMessage(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        <BookOpen aria-hidden />
        {busy ? 'Drafting…' : 'Draft a case study'}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
