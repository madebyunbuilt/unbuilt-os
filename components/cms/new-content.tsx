'use client';

import { useMutation } from 'convex/react';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { FormDialog } from '@/components/app/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api } from '@/convex/_generated/api';
import { CONTENT_LABELS, slugify } from '@/lib/cms-display';

// Starting something new. Only a name and an address are asked for: everything else is written in the editor, where
// the counts and the reasons it cannot be published yet are in front of the person writing it.

type Creatable = 'works' | 'servicePages' | 'posts' | 'legalPages';

const EMPTY_SEO = { title: '', description: '' };

export function NewContent({ table }: { table: Creatable }) {
  const createWork = useMutation(api.cms.createWork);
  const createService = useMutation(api.cms.createServicePage);
  const createPost = useMutation(api.cms.createPost);
  const createLegal = useMutation(api.cms.createLegalPage);
  const router = useRouter();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [touched, setTouched] = useState(false);
  const { one, segment } = CONTENT_LABELS[table];
  const address = touched ? slug : slugify(name);

  return (
    <FormDialog
      trigger={
        <Button>
          <Plus aria-hidden />
          New {one.toLowerCase()}
        </Button>
      }
      title={`New ${one.toLowerCase()}`}
      description="It starts as a draft. Nothing reaches the website until it is published."
      submitLabel="Start writing"
      canSubmit={name.trim().length > 0 && address.length > 0}
      onSubmit={async () => {
        const id =
          table === 'works'
            ? await createWork({
                slug: address,
                name,
                art: '',
                listLine: '',
                listDetail: '',
                seo: EMPTY_SEO,
                summary: '',
                meta: { client: '', year: String(new Date().getFullYear()), role: '', status: '' },
                stack: [],
                brief: [],
                hardPart: [],
                built: [],
                shots: [],
              })
            : table === 'servicePages'
              ? await createService({
                  slug: address,
                  name,
                  short: '',
                  long: '',
                  stack: [],
                  deliverables: [],
                  seo: EMPTY_SEO,
                  body: [],
                })
              : table === 'posts'
                ? await createPost({ slug: address, title: name, excerpt: '', body: [], tags: [], seo: EMPTY_SEO })
                : await createLegal({
                    slug: address,
                    title: name,
                    intro: '',
                    sheet: name,
                    updatedDate: new Date().toISOString().slice(0, 10),
                    sections: [],
                  });
        setName('');
        setSlug('');
        setTouched(false);
        router.push(`/cms/${segment}/${id}`);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="new-name">Name</Label>
        <Input id="new-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-slug">Address</Label>
        <Input
          id="new-slug"
          value={address}
          onChange={(event) => {
            setTouched(true);
            setSlug(event.target.value);
          }}
        />
        {/* Follows the name until somebody edits it, then stops: an address that keeps changing under you is worse. */}
        <p className="text-sm text-muted-foreground">Taken from the name. Change it if you want something else.</p>
      </div>
    </FormDialog>
  );
}
