import { render } from '@react-email/render';
import { createElement } from 'react';
import { Resend } from 'resend';
import { InvitationEmail } from '../../emails/auth/invitation';
import { MagicLinkEmail } from '../../emails/auth/magic-link';
import { PortalInvitationEmail } from '../../emails/auth/portal-invitation';
import { SignInCodeEmail } from '../../emails/auth/sign-in-code';

// Sign-in emails (03-auth-and-permissions.md, Sign-in). Links and codes are secrets: never log them.

export type AuthEmail =
  | { kind: 'magicLink'; to: string; url: string }
  | { kind: 'signInCode'; to: string; code: string }
  | { kind: 'invitation'; to: string; url: string; inviterName: string; roleName: string; expiresAt: number }
  | { kind: 'portalInvitation'; to: string; url: string; inviterName: string; clientName: string };

const DEFAULT_FROM = 'Unbuilt OS <onboarding@resend.dev>';

export async function renderAuthEmail(email: AuthEmail): Promise<{ subject: string; html: string; text: string }> {
  const { subject, element } = (() => {
    switch (email.kind) {
      case 'magicLink':
        return { subject: 'Your Unbuilt OS sign-in link', element: createElement(MagicLinkEmail, { url: email.url }) };
      case 'signInCode':
        return {
          subject: `${email.code} is your Unbuilt OS sign-in code`,
          element: createElement(SignInCodeEmail, { code: email.code }),
        };
      case 'invitation':
        return {
          subject: `${email.inviterName} invited you to Unbuilt OS`,
          element: createElement(InvitationEmail, {
            url: email.url,
            inviterName: email.inviterName,
            roleName: email.roleName,
            expiresOn: new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'Africa/Lagos' }).format(
              email.expiresAt,
            ),
          }),
        };
      case 'portalInvitation':
        return {
          subject: `${email.inviterName} invited you to the Unbuilt client portal`,
          element: createElement(PortalInvitationEmail, {
            url: email.url,
            inviterName: email.inviterName,
            clientName: email.clientName,
          }),
        };
    }
  })();
  return { subject, html: await render(element), text: await render(element, { plainText: true }) };
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
