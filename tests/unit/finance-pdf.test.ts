import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderCreditNotePdf, renderReceiptPdf } from '@/convex/lib/renderDocumentPdf';
import { type CreditNotePdfPayload, type ReceiptPdfPayload } from '@/pdf/types';

// Receipts and credit notes (08-billing-and-finance.md), rendered with the real renderer as the send action does.

const parties = {
  org: { name: 'Unbuilt Studio Ltd', addressLines: ['Jabi', 'Abuja'], email: 'hello@unbuilt.studio', tin: '1234' },
  client: { name: 'Glossup Limited', addressLines: ['Lekki'], tin: '9988' },
  brand: { primary: '#000000' },
};

const receipt: ReceiptPdfPayload = {
  ...parties,
  number: 'UNB-RCT-0001',
  date: '22 September 2026',
  currency: 'NGN',
  invoiceNumber: 'UNB-INV-0010',
  invoiceTotalMinor: 10_000_000,
  amountMinor: 5_700_000,
  whtDeductedMinor: 300_000,
  method: 'Bank transfer',
  reference: 'GTB-88213',
  balanceAfterMinor: 4_000_000,
  createdAtMs: Date.parse('2026-09-22T09:00:00Z'),
};

const creditNote: CreditNotePdfPayload = {
  ...parties,
  number: 'UNB-CN-0001',
  date: '22 September 2026',
  currency: 'NGN',
  invoiceNumber: 'UNB-INV-0010',
  reason: '5 of the 10 days were not delivered',
  lineItems: [
    { description: 'Website design, 5 days', quantityMilli: 1_000, unitPriceMinor: 4_651_163, amountMinor: 4_651_163 },
  ],
  netMinor: 4_651_163,
  vatMinor: 348_837,
  vatBps: 750,
  amountMinor: 5_000_000,
  appliedToInvoiceMinor: 4_000_000,
  heldMinor: 1_000_000,
  createdAtMs: Date.parse('2026-09-22T09:00:00Z'),
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('finance PDFs', () => {
  it('renders a receipt and a credit note, the same bytes every time', async () => {
    for (const render of [() => renderReceiptPdf(receipt), () => renderCreditNotePdf(creditNote)]) {
      const [first, second] = [await render(), await render()];
      expect(first.subarray(0, 5).toString()).toBe('%PDF-');
      expect(sha256(first)).toBe(sha256(second));
    }
  }, 30_000);
});
