import { render } from '@react-email/render';
import { createElement } from 'react';
import { Resend } from 'resend';
import { senderFor } from './senders';
import { InvoiceReminderEmail } from '../../emails/invoices/invoice-reminder';
import { InvoiceSentEmail } from '../../emails/invoices/invoice-sent';

// Invoice emails (08-billing-and-finance.md, Invoices). The PDF goes as an attachment; nothing here logs the message,
// the address or the amount when sending fails.

export type InvoiceEmail = {
  to: string;
  contactName: string;
  number: string;
  typeLabel: string;
  studioName: string;
  senderName: string;
  amount: string;
  dueDate: string;
  message?: string;
  whtNote?: string;
  payUrl?: string;
  bankAccounts: { bankName: string; accountName: string; accountNumber: string; swift?: string; iban?: string }[];
  /** Set when this is the same invoice going out again: the date the client's copy is dated. */
  copyOfDate?: string;
  pdf: { filename: string; content: Uint8Array };
};

export async function renderInvoiceEmail({ pdf: _pdf, to: _to, ...email }: InvoiceEmail) {
  const element = createElement(InvoiceSentEmail, email);
  return {
    subject: email.copyOfDate
      ? `${email.typeLabel} ${email.number} from ${email.studioName} (copy)`
      : `${email.typeLabel} ${email.number} from ${email.studioName}`,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}

export async function sendInvoiceEmail(email: InvoiceEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set on this deployment');
  const { subject, html, text } = await renderInvoiceEmail(email);
  const { error } = await new Resend(apiKey).emails.send({
    from: senderFor('billing'),
    to: email.to,
    subject,
    html,
    text,
    attachments: [{ filename: email.pdf.filename, content: Buffer.from(email.pdf.content) }],
  });
  // Resend's error carries only a name and message, never the email body.
  if (error) throw new Error(`Could not send the invoice email: ${error.name}`);
}

export type ReminderEmail = {
  to: string;
  contactName: string;
  number: string;
  studioName: string;
  balance: string;
  dueDate: string;
  wording: 'soon' | 'today' | 'late';
  payUrl?: string;
  bankAccounts: { bankName: string; accountName: string; accountNumber: string; swift?: string; iban?: string }[];
  pdf?: { filename: string; content: Uint8Array };
};

export async function sendReminderEmail({ to, pdf, ...email }: ReminderEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set on this deployment');
  const element = createElement(InvoiceReminderEmail, email);
  const { error } = await new Resend(apiKey).emails.send({
    from: senderFor('billing'),
    to,
    subject:
      email.wording === 'late'
        ? `Overdue: invoice ${email.number} from ${email.studioName}`
        : `Payment due: invoice ${email.number} from ${email.studioName}`,
    html: await render(element),
    text: await render(element, { plainText: true }),
    attachments: pdf ? [{ filename: pdf.filename, content: Buffer.from(pdf.content) }] : undefined,
  });
  if (error) throw new Error(`Could not send the reminder email: ${error.name}`);
}
