import type { Metadata } from 'next';
import { PortalHome } from '@/components/portal/portal-home';

export const metadata: Metadata = { title: 'Client portal' };

export default function PortalHomePage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
      <PortalHome />
    </div>
  );
}
