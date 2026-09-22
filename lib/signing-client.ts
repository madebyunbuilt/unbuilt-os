import { type DocumentBlock } from '@/convex/lib/documentBlocks';
import { type Currency } from '@/convex/lib/money';

// Calls the public signing endpoints (convex/signing.ts). The token goes in the body, never a URL, so it stays out of
// request logs. Every answer is { ok: true, ... } or { ok: false, code, message }; a failure to reach the server at all
// becomes the same shape, so the page has one thing to handle.

export type SignerStatus = 'waiting' | 'invited' | 'signed' | 'declined' | 'locked';
export type RequestStatus = 'pending' | 'completed' | 'declined' | 'cancelled' | 'expired';

export type SigningPage = {
  signer: { name: string; email: string; status: SignerStatus; codeVerified: boolean };
  request: { status: RequestStatus; expiresAt: number; expired: boolean };
  studioName: string;
  title: string;
  number?: string;
  typeLabel: string;
  /** Present only while the document is this signer's to sign. */
  document: {
    clientName?: string;
    currency: Currency;
    blocks: DocumentBlock[];
    lineItems?: {
      description: string;
      quantityMilli: number;
      unitPriceMinor: number;
      amountMinor: number;
      taxable: boolean;
    }[];
    totals?: {
      subtotalMinor: number;
      discountMinor: number;
      taxableMinor: number;
      vatMinor: number;
      totalMinor: number;
      whtExpectedMinor: number;
    };
    pdfUrl?: string;
    pdfSha256: string;
  } | null;
  consent: { text: string; version: number } | null;
};

export type SigningFailure = { ok: false; code: string; message: string };
type Answer<T> = ({ ok: true } & T) | SigningFailure;

const UNREACHABLE: SigningFailure = {
  ok: false,
  code: 'network',
  message: 'We could not reach the server. Check your connection and try again.',
};

async function call<T>(step: string, body: object): Promise<Answer<T>> {
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site) return { ok: false, code: 'unavailable', message: 'Signing is not available right now.' };
  try {
    const response = await fetch(`${site}/public/sign/${step}`, {
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

export const signing = {
  view: (token: string) => call<{ page: SigningPage }>('view', { token }),
  code: (token: string) => call<{ sentTo: string }>('code', { token }),
  verify: (token: string, code: string) =>
    call<{ verified: boolean; locked?: boolean; attemptsLeft?: number }>('verify', { token, code }),
  upload: (token: string) => call<{ uploadUrl: string }>('upload', { token }),
  sign: (
    token: string,
    body: { method: 'typed' | 'drawn'; typedName?: string; imageStorageId?: string; consent: boolean },
  ) => call<object>('sign', { token, ...body }),
  decline: (token: string, reason: string) => call<object>('decline', { token, reason }),
};

/** Stores a drawn signature through the upload URL the server gave, returning the storage id to sign with. */
export async function uploadSignature(uploadUrl: string, image: Blob): Promise<string | null> {
  try {
    const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: image });
    if (!response.ok) return null;
    const { storageId } = (await response.json()) as { storageId?: string };
    return storageId ?? null;
  } catch {
    return null;
  }
}
