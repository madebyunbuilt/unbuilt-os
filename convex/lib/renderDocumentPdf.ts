'use node';

import { createElement } from 'react';
import { type DocumentPdfPayload } from '../../pdf/types';

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
