// Email arriving at support@ (14-platform.md, Email; 09-support-and-sla.md, Tickets). Providers disagree about what
// to call every field, and the studio has not picked one yet, so what arrives is read tolerantly here and everything
// downstream works on one shape.

export type InboundEmail = {
  messageId: string;
  from: string;
  fromName?: string;
  subject: string;
  body: string;
  /**
   * Resend's own id for the message. Its webhook carries no body at all (studio, 2026-09-25), so this is what the
   * content is fetched with afterwards.
   */
  emailId?: string;
};

const string = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

/** The first address in a header value: `Ada Obi <ada@glossup.com>`, `<ada@glossup.com>` or a bare address. */
export function parseAddress(value: string): { email: string; name?: string } | null {
  const angled = value.match(/<([^>]+)>/);
  const email = (angled ? angled[1] : value.split(',')[0]).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = angled ? value.slice(0, value.indexOf('<')).trim().replace(/^"|"$/g, '') : '';
  return { email, name: name.length > 0 ? name : undefined };
}

/**
 * What the provider sent, in the shape the rest of the code wants. Returns null when the essentials are missing:
 * a sender the studio can read and something to call the ticket.
 */
export function normalise(payload: unknown): InboundEmail | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  // Some providers nest the mail under `data` or `email`, some send it flat.
  const nested = (raw.data ?? raw.email ?? raw) as Record<string, unknown>;
  const field = (...names: string[]): string | undefined => {
    for (const name of names) {
      const value = string(nested[name]) ?? string(raw[name]);
      if (value) return value;
    }
    return undefined;
  };

  const fromValue = field('from', 'sender', 'From');
  const from = fromValue ? parseAddress(fromValue) : null;
  if (!from) return null;

  const body = field('text', 'plain', 'body', 'TextBody', 'stripped-text');
  const subject = field('subject', 'Subject');
  // Resend's webhook carries neither, only an id to fetch the content with, so an email_id counts as substance too.
  if (!subject && !body && !field('email_id', 'emailId')) return null;

  return {
    emailId: field('email_id', 'emailId'),
    messageId: field('messageId', 'message_id', 'MessageID', 'Message-Id', 'id') ?? `${from.email}:${Date.now()}`,
    from: from.email,
    fromName: from.name,
    subject: subject ?? '(no subject)',
    body: body ?? '',
  };
}

/**
 * The ticket a reply belongs to, from its subject. The number is what threads an email back onto its ticket: it
 * survives forwarding, quoting and clients whose mail software drops the headers, which is more than can be said for
 * In-Reply-To.
 */
export function ticketNumberIn(subject: string): string | null {
  const found = subject.match(/UNB-TKT-\d{4,}/i);
  return found ? found[0].toUpperCase() : null;
}

/** Trims a quoted reply down to what the person actually wrote this time. */
export function withoutQuotedReply(body: string): string {
  const lines = body.split(/\r?\n/);
  const cut = lines.findIndex(
    (line) =>
      /^>/.test(line.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line.trim()) ||
      /^On .+ wrote:$/i.test(line.trim()),
  );
  const kept = (cut === -1 ? lines : lines.slice(0, cut)).join('\n').trim();
  // Everything was quoted: better to keep the lot than to store an empty message.
  return kept.length > 0 ? kept : body.trim();
}

/**
 * The address a link really points at. Gmail rewrites every link in the mail it sends through its own redirector, so
 * a ticket would otherwise show google.com/url?q=... where the client wrote a page of their own.
 */
export function unwrapRedirect(href: string): string {
  const match = href.match(/^https?:\/\/(?:www\.)?google\.[^/]+\/url\?(.*)$/i);
  if (!match) return href;
  const target = new URLSearchParams(match[1]).get('q') ?? new URLSearchParams(match[1]).get('url');
  return target && /^https?:\/\//i.test(target) ? target : href;
}

/**
 * The same unwrapping, applied to addresses written out in plain text. Gmail rewrites links in the text part as well
 * as the HTML one, so without this a ticket shows the redirector even when the words came through perfectly.
 */
export function unwrapUrlsIn(text: string): string {
  return text.replace(/https?:\/\/(?:www\.)?google\.[^\s<>"')]+/gi, (url) => unwrapRedirect(url));
}

/** Every link address in a piece of HTML, in the order they appear. */
export function linksIn(html: string): string[] {
  return [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)]
    .map((match) => unwrapRedirect(match[1]))
    .filter((href) => /^https?:\/\//i.test(href));
}

/**
 * HTML as words, keeping where each link went: `Accept the invitation (https://…)`. A link whose text is already its
 * own address is left alone rather than printed twice.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, raw: string, label: string) => {
      const href = unwrapRedirect(raw);
      const words = label
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!/^https?:\/\//i.test(href)) return words;
      return !words || words === href ? href : `${words} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function decodeDataUri(uri: string): string {
  const [header, ...rest] = uri.split(',');
  const payload = rest.join(',');
  try {
    return header.includes('base64') ? atob(payload) : decodeURIComponent(payload);
  } catch {
    return '';
  }
}

/**
 * What an email actually says. The plain-text part is preferred, because it is what the sender's own software chose
 * to write — but mail clients routinely drop link addresses from it, leaving "click here" pointing at nothing. When
 * the HTML holds a link the text does not, the HTML is rendered instead, so the studio can follow what a client sent.
 */
export function readableBody(mail: { text?: string; html?: string }): string | null {
  const text = mail.text?.trim();
  const html = mail.html?.trim();
  const source = html?.startsWith('data:') ? decodeDataUri(html) : html;
  const links = source ? linksIn(source) : [];

  if (text) {
    // Unwrapped first, or the comparison below is fooled: a redirector carries its target inside its own query
    // string, so the address always looks present even when only the wrapper is there.
    const plain = unwrapUrlsIn(text);
    const missing = links.filter((href) => !plain.includes(href));
    if (missing.length === 0 || !source) return plain;
    return htmlToText(source);
  }
  return source ? htmlToText(source) : null;
}

/** Mailboxes that are never a person asking for help, whatever domain they are on. */
const ROBOT_MAILBOXES = [
  'noreply',
  'no-reply',
  'donotreply',
  'do-not-reply',
  'mailer-daemon',
  'postmaster',
  'bounce',
  'bounces',
];

/**
 * Why a message must not become a ticket, or null when it may.
 *
 * A support address that answers its own studio is a loop waiting to happen, and worse: ask Unbuilt OS for a sign-in
 * link at the support address and the link itself would arrive as a ticket that anybody who can read tickets could
 * use. Mail from the studio's own domain is therefore never support, and nor is anything from a robot mailbox — a
 * bounce is a failure to tell somebody about, not a client with a problem.
 */
export function refuseSender(from: string, ownDomain: string | undefined): string | null {
  const [mailbox, domain] = from.toLowerCase().split('@');
  if (!domain) return 'not an address';
  if (ownDomain && domain === ownDomain.toLowerCase()) return "the studio's own domain";
  if (ROBOT_MAILBOXES.includes(mailbox)) return 'a robot mailbox';
  return null;
}

/** The domain the studio sends from, taken from the same setting the from line uses. */
export function ownSendingDomain(from: string | undefined): string | undefined {
  const match = (from ?? '').match(/@([^>\s]+)>?\s*$/);
  return match ? match[1].replace(/>$/, '').toLowerCase() : undefined;
}
