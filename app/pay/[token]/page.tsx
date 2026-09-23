import type { Metadata } from 'next';
import { Mark } from '@/components/brand/mark';
import { PayPage } from '@/components/billing/pay-page';

// The page behind a pay link (08-billing-and-finance.md, Paystack). Public on both hosts, with no session: the link's
// own token is what opens it. The token is in the address, so the page sends no referrer and asks not to be indexed.

export const metadata: Metadata = {
  title: 'Pay an invoice',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function PayInvoicePage({ params }: PageProps<'/pay/[token]'>) {
  const { token } = await params;
  return (
    <div className="flex flex-1 flex-col px-4 py-10 sm:py-16">
      <header className="mx-auto flex w-full max-w-2xl items-center gap-3">
        <Mark size={28} />
        <span className="font-display text-lg font-extrabold tracking-tight">Unbuilt</span>
      </header>
      <main className="mx-auto mt-10 w-full max-w-2xl">
        <PayPage token={token} />
      </main>
    </div>
  );
}
