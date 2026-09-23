import type { Metadata } from 'next';
import { Mark } from '@/components/brand/mark';
import { PayPage } from '@/components/billing/pay-page';

// Where Paystack sends the client back to. It never marks anything paid: the page waits for the webhook to be verified
// and shows the new balance when it is.

export const metadata: Metadata = {
  title: 'Payment',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default async function PayDonePage({ params }: PageProps<'/pay/[token]/done'>) {
  const { token } = await params;
  return (
    <div className="flex flex-1 flex-col px-4 py-10 sm:py-16">
      <header className="mx-auto flex w-full max-w-2xl items-center gap-3">
        <Mark size={28} />
        <span className="font-display text-lg font-extrabold tracking-tight">Unbuilt</span>
      </header>
      <main className="mx-auto mt-10 w-full max-w-2xl">
        <PayPage token={token} returned />
      </main>
    </div>
  );
}
