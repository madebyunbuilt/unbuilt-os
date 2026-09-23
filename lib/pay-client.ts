import { type Currency } from '@/convex/lib/money';

// Calls the public pay endpoints (convex/paying.ts). The token travels in the body, never a URL, and nothing here
// decides whether an invoice is paid: only Paystack's verified webhook does that.

export type PayPageInvoice = {
  number: string;
  status: string;
  studioName: string;
  clientName: string;
  currency: Currency;
  totalMinor: number;
  balanceMinor: number;
  dueDate?: string;
  payable: boolean;
  /** What a client who withholds tax keeps back; zero when this client does not. */
  whtMinor: number;
  whtBps: number;
  byCard: boolean;
  bankAccounts: { bankName: string; accountName: string; accountNumber: string; swift?: string; iban?: string }[];
};

export type PayFailure = { ok: false; code: string; message: string };
type Answer<T> = ({ ok: true } & T) | PayFailure;

const UNREACHABLE: PayFailure = {
  ok: false,
  code: 'network',
  message: 'We could not reach the server. Check your connection and try again.',
};

async function call<T>(step: string, body: object): Promise<Answer<T>> {
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site) return { ok: false, code: 'unavailable', message: 'Paying is not available right now.' };
  try {
    const response = await fetch(`${site}/public/pay/${step}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    const answer = (await response.json().catch(() => null)) as Answer<T> | null;
    if (!answer) return UNREACHABLE;
    if (!answer.ok && !answer.message) return { ...answer, message: 'Something went wrong. Try again.' };
    return answer;
  } catch {
    return UNREACHABLE;
  }
}

export const paying = {
  view: (token: string) => call<{ invoice: PayPageInvoice }>('view', { token }),
  start: (token: string, withholdWht: boolean) =>
    call<{ authorizationUrl: string; amountMinor: number }>('start', { token, withholdWht }),
};
