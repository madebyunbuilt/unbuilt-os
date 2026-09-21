import { render } from '@react-email/render';
import { createElement } from 'react';
import { Resend } from 'resend';
import { DocumentSentEmail } from '../../emails/documents/document-sent';

// The email that carries a document to a client (07-documents-and-esign.md, Send). The document is read in the portal,
// so this only carries the link; nothing here logs the message or the address.

export type DocumentEmail = {
  to: string;
  contactName: string;
  documentTitle: string;
  documentNumber: string;
  typeLabel: string;
  studioName: string;
  senderName: string;
  message?: string;
  portalUrl: string;
  validUntil?: string;
};

const DEFAULT_FROM = 'Unbuilt OS <onboarding@resend.dev>';

export async function renderDocumentEmail(email: DocumentEmail) {
  const element = createElement(DocumentSentEmail, email);
  return {
    subject: `${email.typeLabel} ${email.documentNumber} from ${email.studioName}`,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}

export async function sendDocumentEmail(email: DocumentEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set on this deployment');

  const { subject, html, text } = await renderDocumentEmail(email);
  const { error } = await new Resend(apiKey).emails.send({
    from: process.env.AUTH_EMAIL_FROM ?? DEFAULT_FROM,
    to: email.to,
    subject,
    html,
    text,
  });
  // Resend's error carries only a name and message, never the email body.
  if (error) throw new Error(`Could not send the document email: ${error.name}`);
}
