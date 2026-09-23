// Paystack (08-billing-and-finance.md, Payments; 14-platform.md, Webhooks). Nothing here trusts the browser: a
// transaction is created server-side, and a payment is only ever recorded from a webhook whose signature verified and
// whose transaction Paystack itself confirmed. The secret key never leaves this module.

const API = 'https://api.paystack.co';

export class PaystackError extends Error {}

export function paystackSecret(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new PaystackError('PAYSTACK_SECRET_KEY is not set on this deployment');
  return key;
}

/** Whether card payments can be offered at all. */
export const paystackConfigured = () => !!process.env.PAYSTACK_SECRET_KEY;

/**
 * Currencies this Paystack account can charge (PAYSTACK_CURRENCIES, comma-separated). NGN unless the studio's account
 * has more enabled; anything else is bank transfer only.
 */
export function paystackCurrencies(): string[] {
  return (process.env.PAYSTACK_CURRENCIES ?? 'NGN')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean);
}

export const paystackTakes = (currency: string) => paystackConfigured() && paystackCurrencies().includes(currency);

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${paystackSecret()}`,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as { status?: boolean; message?: string; data?: T } | null;
  if (!response.ok || !body?.status) {
    // Paystack's message describes the request, never the key.
    throw new PaystackError(body?.message ?? `Paystack refused the request (${response.status})`);
  }
  return body.data as T;
}

export type InitialisedTransaction = { authorization_url: string; access_code: string; reference: string };

/** Starts a checkout for exactly `amountMinor`, in the invoice's currency. */
export async function initialiseTransaction(args: {
  email: string;
  amountMinor: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string | number>;
}): Promise<InitialisedTransaction> {
  return await call<InitialisedTransaction>('/transaction/initialize', {
    method: 'POST',
    body: JSON.stringify({
      email: args.email,
      amount: args.amountMinor,
      currency: args.currency,
      reference: args.reference,
      callback_url: args.callbackUrl,
      metadata: args.metadata,
    }),
  });
}

export type PaystackAuthorization = {
  channel?: string;
  brand?: string;
  card_type?: string;
  last4?: string;
  bank?: string;
  mobile_money_number?: string;
};

export type VerifiedTransaction = {
  status: string;
  reference: string;
  amount: number;
  currency: string;
  id: number;
  fees?: number;
  paid_at?: string;
  /** card, bank_transfer, bank, ussd, qr, mobile_money, eft. */
  channel?: string;
  authorization?: PaystackAuthorization;
  metadata?: Record<string, unknown>;
};

const CHANNELS: Record<string, string> = {
  card: 'Card',
  bank: 'Bank account',
  bank_transfer: 'Bank transfer',
  ussd: 'USSD',
  qr: 'QR',
  mobile_money: 'Mobile money',
  eft: 'Bank transfer',
};

/** How the client paid, in the studio's words: "Card · Visa ending 4081", "Bank transfer · GTBank". */
export function describeChannel(channel: string | undefined, authorization: PaystackAuthorization | undefined) {
  const name = CHANNELS[channel ?? ''] ?? 'Paystack';
  const card = authorization?.last4
    ? `${(authorization.brand ?? authorization.card_type ?? 'card').trim()} ending ${authorization.last4}`
    : undefined;
  const detail = card ?? authorization?.bank ?? authorization?.mobile_money_number;
  return { channel: channel ?? 'unknown', instrument: detail ? `${name} · ${detail}` : name };
}

/** What Paystack says about a transaction. The only source the studio trusts for "this was paid". */
export async function verifyTransaction(reference: string): Promise<VerifiedTransaction> {
  return await call<VerifiedTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

export async function refundTransaction(args: { reference: string; amountMinor: number }): Promise<{ id: number }> {
  return await call<{ id: number }>('/refund', {
    method: 'POST',
    body: JSON.stringify({ transaction: args.reference, amount: args.amountMinor }),
  });
}

const toHex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');

/** HMAC-SHA512 of the raw body with the secret key, as Paystack signs its webhooks. */
export async function signatureFor(rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(paystackSecret()),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
}

/** Compares in constant time, so a wrong signature takes as long to refuse as a nearly right one. */
export function sameSignature(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** The reference for one attempt at paying an invoice: readable in Paystack's dashboard, unique per attempt. */
export const paymentReference = (invoiceId: string, attempt: number) => `inv_${invoiceId}_${attempt}`;
