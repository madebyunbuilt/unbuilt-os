import { Fragment, type ReactNode } from 'react';

// Text somebody else wrote, with its links made clickable (09-support-and-sla.md, Tickets). The text stays text all
// the way from the email to the screen: the anchors are built here, by React, so nothing a client sends can carry
// markup or script into either surface.

// Stops before the punctuation a sentence puts after a link, and before the closing bracket of a wrapped one.
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

/** Trailing punctuation belongs to the sentence, not to the address. */
function trimTrailing(url: string): { href: string; after: string } {
  const match = url.match(/[.,;:!?]+$/);
  return match ? { href: url.slice(0, -match[0].length), after: match[0] } : { href: url, after: '' };
}

export function LinkedText({ children }: { children: string }): ReactNode {
  const parts: ReactNode[] = [];
  let index = 0;
  let key = 0;

  for (const match of children.matchAll(URL_PATTERN)) {
    const start = match.index;
    if (start > index) parts.push(children.slice(index, start));
    const { href, after } = trimTrailing(match[0]);
    parts.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="underline underline-offset-2 break-all"
      >
        {href}
      </a>,
    );
    if (after) parts.push(after);
    index = start + match[0].length;
  }
  if (index < children.length) parts.push(children.slice(index));

  return (
    <>
      {parts.map((part, at) => (
        <Fragment key={at}>{part}</Fragment>
      ))}
    </>
  );
}
