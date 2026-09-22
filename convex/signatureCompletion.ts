'use node';

import { createHash } from 'node:crypto';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import { type Id } from './_generated/dataModel';
import { internalAction } from './lib/functions';
import { appendPdf, renderCertificatePdf } from './lib/renderDocumentPdf';
import { sendSignatureEmail } from './lib/signatureEmails';

// Completion (07-documents-and-esign.md, Completion). When the last signer signs, this builds the signed PDF from the
// stored original, whose hash must still match the one the request locked, plus the certificate page; stores it with its
// own hash; and emails every signer a copy. The signatures are already recorded, so a failure here only delays the PDF,
// and whoever set up the request is told and can run it again.

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function bytesOf(ctx: { storage: { get: (id: Id<'_storage'>) => Promise<Blob | null> } }, id: Id<'_storage'>) {
  const blob = await ctx.storage.get(id);
  if (!blob) throw new Error('A stored file is missing');
  return new Uint8Array(await blob.arrayBuffer());
}

export const complete = internalAction({
  args: { requestId: v.id('signatureRequests') },
  handler: async (ctx, { requestId }): Promise<null> => {
    try {
      const data = await ctx.runQuery(internal.signatures.completionData, { requestId });
      if (!data) return null;

      const original = await bytesOf(ctx, data.originalStorageId);
      if (sha256(original) !== data.pdfSha256) {
        throw new Error('The stored PDF no longer matches the one that was signed');
      }

      const signers = [];
      for (const { imageStorageId, ...signer } of data.signers) {
        const imageDataUri = imageStorageId
          ? `data:image/png;base64,${Buffer.from(await bytesOf(ctx, imageStorageId)).toString('base64')}`
          : undefined;
        signers.push({ ...signer, imageDataUri });
      }
      const certificate = await renderCertificatePdf({ ...data.certificate, signers });
      const signed = await appendPdf(original, new Uint8Array(certificate));
      const signedSha256 = sha256(signed);

      const storageId = await ctx.storage.store(
        new Blob([signed as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      );
      const stored = await ctx.runMutation(internal.signatures.attachFinalPdf, {
        requestId,
        storageId,
        fileName: data.fileName,
        sha256: signedSha256,
      });
      if (!stored.ok) throw new Error(stored.message);

      // The signed PDF is stored now; a copy that fails to send is reported without undoing that.
      let unsent = 0;
      for (const signer of data.signers) {
        await sendSignatureEmail({
          kind: 'signedCopy',
          to: signer.email,
          signerName: signer.name,
          documentTitle: data.certificate.title,
          documentNumber: data.certificate.number,
          typeLabel: data.certificate.typeLabel,
          studioName: data.certificate.org.name,
          sha256: signedSha256,
          pdf: { filename: data.fileName, content: signed },
        }).catch(() => unsent++);
      }
      if (unsent > 0) {
        await ctx.runMutation(internal.signatures.reportCompletionFailed, {
          requestId,
          reason: `The signed PDF is on the document, but ${unsent} signer copies could not be emailed. Download it and send it on.`,
        });
      }
      return null;
    } catch (error) {
      await ctx.runMutation(internal.signatures.reportCompletionFailed, {
        requestId,
        reason: error instanceof Error ? error.message : 'The signed PDF could not be made',
      });
      throw error;
    }
  },
});

/** Recomputes both stored PDFs' hashes and records whether they still match the recorded ones. */
export const verify = internalAction({
  args: { requestId: v.id('signatureRequests'), memberId: v.id('teamMembers') },
  handler: async (ctx, { requestId, memberId }): Promise<null> => {
    const data = await ctx.runQuery(internal.signatures.verificationData, { requestId });
    if (!data) return null;
    let ok = !!data.original && !!data.signed;
    for (const file of [data.original, data.signed]) {
      if (!file) continue;
      const blob = await ctx.storage.get(file.storageId);
      if (!blob || sha256(new Uint8Array(await blob.arrayBuffer())) !== file.sha256) ok = false;
    }
    await ctx.runMutation(internal.signatures.recordVerification, { requestId, memberId, ok });
    return null;
  },
});
