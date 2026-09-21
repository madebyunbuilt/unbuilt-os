import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { renderDocumentPdf } from '@/convex/lib/renderDocumentPdf';
import { type DocumentPdfPayload } from '@/pdf/types';

// The PDF a client receives (07-documents-and-esign.md, PDF rendering). This runs the real renderer in Node, as the
// Convex action does, and checks the one property the signature certificate depends on: the same version always renders
// to the same bytes, so its hash is stable.

const payload: DocumentPdfPayload = {
  blocks: [
    { kind: 'heading', text: 'Quote UNB-QUO-0001' },
    { kind: 'paragraph', text: 'Prepared for Ada Obi, Founder at Glossup, on 21 September 2026.' },
    { kind: 'heading', text: 'What is included', level: 2 },
    { kind: 'lineItems', title: 'The work' },
    { kind: 'totals' },
    { kind: 'milestones', title: 'Milestones' },
    { kind: 'pageBreak' },
    { kind: 'signature', party: 'client' },
    { kind: 'signature', party: 'studio' },
  ],
  title: 'Glossup app, phase one',
  typeLabel: 'Quote',
  number: 'UNB-QUO-0001',
  org: {
    name: 'Unbuilt Studio Ltd',
    addressLines: ['12 Example Street', 'Lagos'],
    email: 'hello@unbuilt.studio',
    phone: '+2348012345678',
    website: 'https://unbuilt.studio',
    tin: '12345678-0001',
  },
  client: { name: 'Glossup Limited', addressLines: ['12 Admiralty Way', 'Lekki'] },
  currency: 'NGN',
  lineItems: [
    { description: 'Design', quantityMilli: 1_000, unitPriceMinor: 1_000_000, amountMinor: 1_000_000, taxable: true },
    { description: 'Build', quantityMilli: 2_000, unitPriceMinor: 500_000, amountMinor: 1_000_000, taxable: false },
  ],
  totals: {
    subtotalMinor: 2_000_000,
    discountMinor: 0,
    taxableMinor: 1_000_000,
    vatMinor: 75_000,
    totalMinor: 2_075_000,
    whtExpectedMinor: 100_000,
  },
  milestones: [{ name: 'Design', dueDate: '1 October 2026' }],
  paymentSchedule: [],
  brand: { primary: '#11297A', accent: '#FFC400' },
  createdAtMs: Date.parse('2026-09-21T09:00:00Z'),
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('the document PDF', () => {
  it('renders a real PDF', async () => {
    const pdf = await renderDocumentPdf(payload);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  }, 30_000);

  it('renders the same bytes for the same version, so the hash is stable', async () => {
    const [first, second] = [await renderDocumentPdf(payload), await renderDocumentPdf(payload)];
    expect(sha256(first)).toBe(sha256(second));
  }, 30_000);

  it('renders different bytes once the document changes', async () => {
    const first = await renderDocumentPdf(payload);
    const second = await renderDocumentPdf({ ...payload, title: 'Glossup app, phase two' });
    expect(sha256(first)).not.toBe(sha256(second));
  }, 30_000);

  it('draws a void document with its watermark', async () => {
    const plain = await renderDocumentPdf(payload);
    const voided = await renderDocumentPdf({ ...payload, voided: true });
    expect(sha256(voided)).not.toBe(sha256(plain));
  }, 30_000);
});
