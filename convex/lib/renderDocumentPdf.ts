'use node';

import { PDFDocument } from 'pdf-lib';
import { createElement } from 'react';
import { type CertificatePdfProps, type DocumentPdfPayload } from '../../pdf/types';

// Rendering runs in a Node action (07-documents-and-esign.md, PDF rendering).
//
// Two things here are deliberate. The renderer and the template are loaded inside the function, because naming them at
// the top would pull react-pdf's types into convex/_generated/api.d.ts, where they cost every api.* result its type.
// And react-pdf is an external package (convex.json), because its pdfkit dependency reaches for "#standard-fonts/*"
// subpath imports the bundler cannot follow; installed in the Node runtime it resolves them itself. An external package
// arrives as CommonJS, where the named export is the real one and `default` may be a partial copy, so the named export
// is taken first.

type Renderer = { renderToBuffer?: (element: unknown) => Promise<Buffer> };

/** The document as PDF bytes. The same payload always renders the same bytes, so its hash is stable. */
export async function renderDocumentPdf({ createdAtMs, ...props }: DocumentPdfPayload): Promise<Buffer> {
  const [renderer, template] = await Promise.all([import('@react-pdf/renderer'), import('../../pdf/document')]);
  const loaded = renderer as unknown as Renderer & { default?: Renderer };
  const renderToBuffer = loaded.renderToBuffer ?? loaded.default?.renderToBuffer;
  if (!renderToBuffer) throw new Error('The PDF renderer is not available in this runtime');
  return await renderToBuffer(createElement(template.DocumentPdf, { ...props, createdAt: new Date(createdAtMs) }));
}

/** The signature certificate on its own, rendered the same way. */
export async function renderCertificatePdf(props: CertificatePdfProps): Promise<Buffer> {
  const [renderer, template] = await Promise.all([import('@react-pdf/renderer'), import('../../pdf/certificate')]);
  const loaded = renderer as unknown as Renderer & { default?: Renderer };
  const renderToBuffer = loaded.renderToBuffer ?? loaded.default?.renderToBuffer;
  if (!renderToBuffer) throw new Error('The PDF renderer is not available in this runtime');
  return await renderToBuffer(createElement(template.CertificatePdf, props));
}

/**
 * The signed document: the original's pages untouched, then the certificate's. The original's metadata is kept as it
 * was, so nothing in the pages the signers read changes.
 */
export async function appendPdf(original: Uint8Array, appended: Uint8Array): Promise<Uint8Array> {
  const signed = await PDFDocument.load(original, { updateMetadata: false });
  const extra = await PDFDocument.load(appended, { updateMetadata: false });
  const pages = await signed.copyPages(extra, extra.getPageIndices());
  for (const page of pages) signed.addPage(page);
  return await signed.save({ updateFieldAppearances: false });
}
