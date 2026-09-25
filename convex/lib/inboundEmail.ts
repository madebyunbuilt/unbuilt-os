// Email arriving at support@ (14-platform.md, Email; 09-support-and-sla.md, Tickets). Providers disagree about what
// to call every field, and the studio has not picked one yet, so what arrives is read tolerantly here and everything
// downstream works on one shape.

export type InboundEmail = {
  messageId: string;
  from: string;
  fromName?: string;
  subject: string;
  body: string;
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
  // A message with neither a subject nor a body is not something anybody can act on.
  if (!subject && !body) return null;

  return {
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
