import type { Metadata } from 'next';
import { Mark } from '@/components/brand/mark';
import { SigningCeremony } from '@/components/signing/signing-ceremony';

// The page behind a signing link (07-documents-and-esign.md, The signing ceremony). Public on both hosts, with no
// session: the link's own token and the emailed code are what let the signer in. The token is in the address, so the
// page sends no referrer anywhere and asks not to be indexed.

export const metadata: Metadata = {
  title: 'Sign a document',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function SignPage({ params }: PageProps<'/sign/[token]'>) {
  const { token } = await params;
  return (
    <div className="flex flex-1 flex-col px-4 py-10 sm:py-16">
      <header className="mx-auto flex w-full max-w-3xl items-center gap-3">
        <Mark size={28} />
        <span className="font-display text-lg font-extrabold tracking-tight">Unbuilt</span>
      </header>
      <main className="mx-auto mt-10 w-full max-w-3xl">
        <SigningCeremony token={token} />
      </main>
    </div>
  );
}
