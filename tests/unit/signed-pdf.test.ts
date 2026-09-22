import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { appendPdf, renderCertificatePdf, renderDocumentPdf } from '@/convex/lib/renderDocumentPdf';
import { type CertificatePdfProps, type DocumentPdfPayload } from '@/pdf/types';

// The signed PDF (07-documents-and-esign.md, Completion): the pages the signers read, untouched, then the certificate.
// This runs the real renderer and pdf-lib in Node, as the completion action does.

const document: DocumentPdfPayload = {
  blocks: [
    { kind: 'heading', text: 'Contract UNB-CON-0001' },
    { kind: 'paragraph', text: 'The studio and the client agree as follows.' },
    { kind: 'signature', party: 'client' },
    { kind: 'signature', party: 'studio' },
  ],
  title: 'Glossup services agreement',
  typeLabel: 'Contract',
  number: 'UNB-CON-0001',
  org: { name: 'Unbuilt Studio Ltd', addressLines: ['Lagos'] },
  client: { name: 'Glossup Limited', addressLines: [] },
  currency: 'NGN',
  paymentSchedule: [],
  brand: { primary: '#11297A', accent: '#FFC400' },
  createdAtMs: Date.parse('2026-09-21T09:00:00Z'),
};

// A 1×1 transparent PNG, standing in for a drawn signature.
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const certificate = (sha256: string): CertificatePdfProps => ({
  org: { name: 'Unbuilt Studio Ltd' },
  brand: { primary: '#11297A' },
  typeLabel: 'Contract',
  number: 'UNB-CON-0001',
  title: 'Glossup services agreement',
  documentSha256: sha256,
  completedAt: Date.parse('2026-09-23T10:00:00Z'),
  signers: [
    {
      name: 'Ada Obi',
      email: 'ada@glossup.com',
      role: 'Client',
      method: 'drawn',
      imageDataUri: PNG,
      verification: 'email_code',
      otpVerifiedAt: Date.parse('2026-09-23T09:55:00Z'),
      signedAt: Date.parse('2026-09-23T09:57:00Z'),
      ip: '203.0.113.7',
      userAgent: 'Safari',
      consentText: 'I agree that my electronic signature is the legal equivalent of my handwritten signature.',
      consentVersion: 1,
    },
    {
      name: 'Kemi Bello',
      email: 'kemi@unbuilt.studio',
      role: 'Unbuilt Studio Ltd',
      method: 'typed',
      typedName: 'Kemi Bello',
      verification: 'app_session',
      otpVerifiedAt: Date.parse('2026-09-23T08:00:00Z'),
      signedAt: Date.parse('2026-09-23T10:00:00Z'),
      consentText: 'I agree that my electronic signature is the legal equivalent of my handwritten signature.',
      consentVersion: 1,
    },
  ],
});

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('the signed PDF', () => {
  it('keeps every original page and adds the certificate after them', async () => {
    const original = new Uint8Array(await renderDocumentPdf(document));
    const cert = await renderCertificatePdf(certificate(sha256(original)));
    const signed = await appendPdf(original, new Uint8Array(cert));

    const [before, after, certPages] = await Promise.all([
      PDFDocument.load(original),
      PDFDocument.load(signed),
      PDFDocument.load(cert),
    ]);
    expect(after.getPageCount()).toBe(before.getPageCount() + certPages.getPageCount());
    // The signed file keeps the original's own metadata rather than being restamped.
    expect(after.getTitle()).toBe(before.getTitle());
    expect(after.getCreationDate()?.getTime()).toBe(before.getCreationDate()?.getTime());
  }, 30_000);

  it('renders the same certificate to the same bytes, and a different one once the evidence differs', async () => {
    const props = certificate('a'.repeat(64));
    const [first, second] = [await renderCertificatePdf(props), await renderCertificatePdf(props)];
    expect(sha256(first)).toBe(sha256(second));
    const changed = await renderCertificatePdf({ ...props, documentSha256: 'b'.repeat(64) });
    expect(sha256(changed)).not.toBe(sha256(first));
  }, 30_000);
});
