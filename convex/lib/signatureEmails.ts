import { render } from '@react-email/render';
import { createElement } from 'react';
import { Resend } from 'resend';
import { senderFor } from './senders';
import { SignedCopyEmail } from '../../emails/signatures/signed-copy';
import { SigningCodeEmail } from '../../emails/signatures/signing-code';
import { type SigningRequestReason, SigningRequestEmail } from '../../emails/signatures/signing-request';

// Signing emails (07-documents-and-esign.md, E-signatures). Links and codes are secrets: never log them, and nothing
// here reports an address or a body when sending fails.

type Common = { to: string; documentNumber: string };

export type SignatureEmail =
  | (Common & {
      kind: 'request';
      reason: SigningRequestReason;
      signerName: string;
      documentTitle: string;
      typeLabel: string;
      studioName: string;
      signingUrl: string;
      expiresAt: number;
    })
  | (Common & { kind: 'code'; code: string })
  | (Common & {
      kind: 'signedCopy';
      signerName: string;
      documentTitle: string;
      typeLabel: string;
      studioName: string;
      sha256: string;
      pdf: { filename: string; content: Uint8Array };
    });

const longDate = (at: number) =>
  new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Africa/Lagos' }).format(at);

export async function renderSignatureEmail(email: SignatureEmail) {
  const { subject, element } = (() => {
    switch (email.kind) {
      case 'request':
        return {
          subject:
            email.reason === 'invitation' || email.reason === 'resend'
              ? `Please sign ${email.typeLabel.toLowerCase()} ${email.documentNumber} from ${email.studioName}`
              : `Reminder: ${email.typeLabel.toLowerCase()} ${email.documentNumber} is waiting for your signature`,
          element: createElement(SigningRequestEmail, {
            reason: email.reason,
            signerName: email.signerName,
            documentTitle: email.documentTitle,
            documentNumber: email.documentNumber,
            typeLabel: email.typeLabel,
            studioName: email.studioName,
            signingUrl: email.signingUrl,
            expiresOn: longDate(email.expiresAt),
          }),
        };
      case 'code':
        return {
          subject: `${email.code} is your code to sign ${email.documentNumber}`,
          element: createElement(SigningCodeEmail, { code: email.code, documentNumber: email.documentNumber }),
        };
      case 'signedCopy':
        return {
          subject: `Signed: ${email.typeLabel.toLowerCase()} ${email.documentNumber}`,
          element: createElement(SignedCopyEmail, {
            signerName: email.signerName,
            documentTitle: email.documentTitle,
            documentNumber: email.documentNumber,
            typeLabel: email.typeLabel,
            studioName: email.studioName,
            sha256: email.sha256,
          }),
        };
    }
  })();
  return { subject, html: await render(element), text: await render(element, { plainText: true }) };
}

/** Throws when this deployment cannot send email, so a caller can stop before changing anything. */
export function assertCanSendEmail(): string {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set on this deployment');
  return apiKey;
}

export async function sendSignatureEmail(email: SignatureEmail): Promise<void> {
  const apiKey = assertCanSendEmail();

  const { subject, html, text } = await renderSignatureEmail(email);
  const { error } = await new Resend(apiKey).emails.send({
    from: senderFor('notifications'),
    to: email.to,
    subject,
    html,
    text,
    attachments:
      email.kind === 'signedCopy'
        ? [{ filename: email.pdf.filename, content: Buffer.from(email.pdf.content) }]
        : undefined,
  });
  // Resend's error carries only a name and message, never the email body.
  if (error) throw new Error(`Could not send the signing ${email.kind} email: ${error.name}`);
}
