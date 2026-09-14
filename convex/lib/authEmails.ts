import { render } from '@react-email/render';
import { createElement } from 'react';
import { Resend } from 'resend';
import { MagicLinkEmail } from '../../emails/auth/magic-link';
import { SignInCodeEmail } from '../../emails/auth/sign-in-code';

// Sign-in emails (03-auth-and-permissions.md, Sign-in). Links and codes are secrets: never log them.

export type AuthEmail =
  { kind: 'magicLink'; to: string; url: string } | { kind: 'signInCode'; to: string; code: string };

const DEFAULT_FROM = 'Unbuilt OS <onboarding@resend.dev>';

export async function renderAuthEmail(email: AuthEmail): Promise<{ subject: string; html: string; text: string }> {
  const element =
    email.kind === 'magicLink'
      ? createElement(MagicLinkEmail, { url: email.url })
      : createElement(SignInCodeEmail, { code: email.code });
  return {
    subject:
      email.kind === 'magicLink' ? 'Your Unbuilt OS sign-in link' : `${email.code} is your Unbuilt OS sign-in code`,
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set on this deployment');

  const { subject, html, text } = await renderAuthEmail(email);
  const { error } = await new Resend(apiKey).emails.send({
    from: process.env.AUTH_EMAIL_FROM ?? DEFAULT_FROM,
    to: email.to,
    subject,
    html,
    text,
  });
  // Resend's error carries only a name and message, never the email body.
  if (error) throw new Error(`Could not send the ${email.kind} email: ${error.name}`);
}
