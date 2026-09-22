import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderInvoicePdf } from '@/convex/lib/renderDocumentPdf';
import { type InvoicePdfPayload } from '@/pdf/types';

// The invoice PDF (08-billing-and-finance.md). This runs the real renderer in Node, as the send action does: the same
// invoice renders to the same bytes, and a void one is marked.

const payload: InvoicePdfPayload = {
  number: 'UNB-INV-0007',
  typeLabel: 'Invoice',
  issueDate: '22 September 2026',
  dueDate: '22 October 2026',
  currency: 'NGN',
  org: {
    name: 'Unbuilt Studio Ltd',
    addressLines: ['Jabi', 'Abuja'],
    email: 'hello@unbuilt.studio',
    tin: '12345678-0001',
    vatNumber: 'VAT-0001',
  },
  client: { name: 'Glossup Limited', addressLines: ['12 Admiralty Way', 'Lekki'], tin: '99887766-0001' },
  lineItems: [
    { description: 'Design', quantityMilli: 1_000, unitPriceMinor: 1_000_000, amountMinor: 1_000_000, taxable: true },
    { description: 'Hosting', quantityMilli: 2_000, unitPriceMinor: 500_000, amountMinor: 1_000_000, taxable: false },
  ],
  totals: {
    subtotalMinor: 2_000_000,
    discountMinor: 200_000,
    taxableMinor: 900_000,
    vatMinor: 67_500,
    totalMinor: 1_867_500,
    whtExpectedMinor: 90_000,
  },
  vat: { applies: true, bps: 750 },
  vatTreatment: 'standard',
  wht: { applies: true, bps: 500 },
  bankAccounts: [
    { label: 'Naira', bankName: 'GTBank', accountName: 'Unbuilt Studio Ltd', accountNumber: '0123456789' },
  ],
  notes: 'Thank you for the work.',
  terms: 'Payable within 30 days.',
  footer: 'Unbuilt Studio Ltd, RC 1234567.',
  brand: { primary: '#000000', accent: '#FFC400' },
  createdAtMs: Date.parse('2026-09-22T00:00:00Z'),
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('the invoice PDF', () => {
  it('renders a real PDF, the same bytes every time', async () => {
    const [first, second] = [await renderInvoicePdf(payload), await renderInvoicePdf(payload)];
    expect(first.subarray(0, 5).toString()).toBe('%PDF-');
    expect(sha256(first)).toBe(sha256(second));
  }, 30_000);

  it('marks a void invoice, and prints the treatment when no VAT is charged', async () => {
    const plain = await renderInvoicePdf(payload);
    expect(sha256(await renderInvoicePdf({ ...payload, voided: true }))).not.toBe(sha256(plain));
    const zeroRated = await renderInvoicePdf({
      ...payload,
      vat: { applies: false, bps: 750 },
      vatTreatment: 'zero_rated',
      totals: { ...payload.totals, vatMinor: 0, totalMinor: 1_800_000 },
    });
    expect(sha256(zeroRated)).not.toBe(sha256(plain));
  }, 30_000);
});
