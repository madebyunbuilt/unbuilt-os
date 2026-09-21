'use node';

import { type DocumentPdfPayload } from '../../pdf/types';

// Rendering runs in a Node action (07-documents-and-esign.md, PDF rendering). The renderer and the template are loaded
// inside the function so this module's own types stay small: convex/_generated/api.d.ts includes every file here, and a
// heavy type in that graph costs every api.* result its type.

/** The document as PDF bytes. The same payload always renders the same bytes, so its hash is stable. */
export async function renderDocumentPdf({ createdAtMs, ...props }: DocumentPdfPayload): Promise<Buffer> {
  const [{ renderToBuffer }, { DocumentPdf }, { createElement }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('../../pdf/document'),
    import('react'),
  ]);
  return await renderToBuffer(createElement(DocumentPdf, { ...props, createdAt: new Date(createdAtMs) }));
}
