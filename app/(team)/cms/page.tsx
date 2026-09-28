import type { Metadata } from 'next';
import Link from 'next/link';
import { RequirePermission } from '@/components/app/require-permission';
import { CONTENT_LABELS, CONTENT_TABLES } from '@/lib/cms-display';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Website' };

export default async function CmsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['cms.view']} what="the website">
      <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-8 sm:px-6 lg:py-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Website</h1>
          <p className="text-muted-foreground">
            What unbuilt.studio says. Everything here is a draft until it is published, and publishing rebuilds the
            site.
          </p>
        </div>
        <ul className="grid gap-3 sm:grid-cols-2">
          {CONTENT_TABLES.map((table) => (
            <li key={table}>
              <Link
                href={`/cms/${CONTENT_LABELS[table].segment}`}
                className="block rounded-lg border p-4 hover:bg-muted/50"
              >
                <p className="font-medium">{CONTENT_LABELS[table].many}</p>
                <p className="text-sm text-muted-foreground">{CONTENT_LABELS[table].blurb}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </RequirePermission>
  );
}
