import type { Metadata } from 'next';
import { RequirePermission } from '@/components/app/require-permission';
import { Testimonials } from '@/components/cms/testimonials';
import { getViewer } from '@/lib/viewer';

export const metadata: Metadata = { title: 'Testimonials' };

export default async function TestimonialsPage() {
  const permissions = (await getViewer())?.permissions ?? [];
  return (
    <RequirePermission permissions={permissions} anyOf={['cms.view']} what="the website">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:py-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Testimonials</h1>
          <p className="text-muted-foreground">
            Quotes on case studies and the home page. A quote needs the client&rsquo;s approval before it can be
            published.
          </p>
        </div>
        <Testimonials />
      </div>
    </RequirePermission>
  );
}
