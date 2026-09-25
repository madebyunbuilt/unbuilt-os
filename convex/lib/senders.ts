// Who an email comes from (14-platform.md, Email). Three addresses, each one a promise about what it carries: a
// client can filter on them, and a reply to a ticket has to land somewhere the inbound webhook reads.

export type Sender = 'notifications' | 'billing' | 'support';

/**
 * The from line for a kind of mail. `AUTH_EMAIL_FROM` names the display name and the domain; the mailbox in front of
 * the @ comes from what the mail is for. Set per-sender overrides only when one of them has to differ.
 */
export function senderFor(sender: Sender): string {
  const override = process.env[`EMAIL_FROM_${sender.toUpperCase()}`];
  if (override) return override;

  const configured = process.env.AUTH_EMAIL_FROM ?? 'Unbuilt OS <onboarding@resend.dev>';
  const match = configured.match(/^(.*)<([^@>]+)@([^>]+)>$/);
  // An address the studio has not set up as three mailboxes, such as Resend's sandbox one, is left exactly as it is:
  // rewriting it would send from a mailbox that does not exist.
  if (!match) return configured;
  const [, name, mailbox, domain] = match;
  if (domain.toLowerCase() === 'resend.dev') return configured;
  // Keeps the studio's own naming when it already matches, so notifications@ stays notifications@.
  const wanted = sender === 'notifications' ? mailbox : sender;
  return `${name}<${wanted}@${domain}>`;
}
