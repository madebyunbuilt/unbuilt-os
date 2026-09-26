import { render } from '@react-email/render';
import { createElement } from 'react';
import { Resend } from 'resend';
import { senderFor } from './senders';
import { FinanceDocumentEmail } from '../../emails/finance/finance-document';

// Receipt and credit note emails. The PDF goes as an attachment; nothing here logs the address or the amount.

export type FinanceEmail = {
  to: string;
  contactName: string;
  kind: 'Receipt' | 'Credit note';
  number: string;
  studioName: string;
  summary: string;
  pdf: { filename: string; content: Uint8Array };
};

export async function sendFinanceEmail({ to, pdf, ...email }: FinanceEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set on this deployment');
  const element = createElement(FinanceDocumentEmail, email);
  const { error } = await new Resend(apiKey).emails.send({
    from: senderFor('billing'),
    to,
    subject: `${email.kind} ${email.number} from ${email.studioName}`,
    html: await render(element),
    text: await render(element, { plainText: true }),
    attachments: [{ filename: pdf.filename, content: Buffer.from(pdf.content) }],
  });
  if (error) throw new Error(`Could not send the ${email.kind.toLowerCase()} email: ${error.name}`);
}
