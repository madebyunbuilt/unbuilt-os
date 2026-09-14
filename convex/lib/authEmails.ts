import { Resend } from 'resend';

// Sign-in emails (03-auth-and-permissions.md, Sign-in). Links and codes are secrets: never log them.
// The branded React Email templates in emails/auth/ replace these bodies when the sign-in screens land.

export type AuthEmail =
  { kind: 'magicLink'; to: string; url: string } | { kind: 'signInCode'; to: string; code: string };

const DEFAULT_FROM = 'Unbuilt OS <onboarding@resend.dev>';

function render(email: AuthEmail): { subject: string; text: string; html: string } {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  if (email.kind === 'magicLink') {
    return {
      subject: 'Your Unbuilt OS sign-in link',
      text: `Sign in to Unbuilt OS:\n\n${email.url}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, ignore this email.`,
      html: `<p>Sign in to Unbuilt OS:</p><p><a href="${escape(email.url)}">Sign in</a></p><p>The link works once and expires in 15 minutes. If you did not ask for it, ignore this email.</p>`,
    };
  }
  return {
    subject: `${email.code} is your Unbuilt OS sign-in code`,
    text: `Your sign-in code is ${email.code}.\n\nIt expires in 3 minutes. If you did not try to sign in, ignore this email.`,
    html: `<p>Your sign-in code is <strong>${escape(email.code)}</strong>.</p><p>It expires in 3 minutes. If you did not try to sign in, ignore this email.</p>`,
  };
}

export async function sendAuthEmail(email: AuthEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY is not set on this deployment');

  const { subject, text, html } = render(email);
  const { error } = await new Resend(apiKey).emails.send({
    from: process.env.AUTH_EMAIL_FROM ?? DEFAULT_FROM,
    to: email.to,
    subject,
    text,
    html,
  });
  // Resend's error carries only a name and message, never the email body.
  if (error) throw new Error(`Could not send the ${email.kind} email: ${error.name}`);
}
