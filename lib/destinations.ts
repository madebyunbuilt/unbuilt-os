import { type NavSection } from '@/lib/navigation';
import { SETTINGS_SECTIONS } from '@/lib/settings-sections';
import { type Surface } from '@/lib/surface';

// Everywhere the palette can send somebody (14-platform.md, Search and command palette). A destination carries the
// trail it sits on, not just its own name, so something buried three levels down can be found by what it is rather
// than by remembering where it lives.

export type Destination = {
  label: string;
  /** The path to it, biggest first: ['Settings', 'Billing']. Shown above the label, the way iOS shows it. */
  trail: readonly string[];
  href: string;
  /** What somebody might type instead of the label. "vat" should find the tax rate; "bank" should find payment details. */
  keywords?: readonly string[];
  anyOf?: readonly string[];
  built?: boolean;
};

/**
 * The settings a person can name but could not point to. Each is an anchor on the page that holds it, so choosing one
 * lands on the part they were after rather than at the top of a long form.
 */
const SETTINGS_DETAILS: readonly Destination[] = [
  {
    label: 'Bank accounts',
    trail: ['Settings', 'Billing'],
    href: '/settings/billing#bank-heading',
    keywords: ['account number', 'iban', 'swift', 'sort code', 'payment details', 'transfer'],
    anyOf: ['settings.billing.sensitive'],
  },
  {
    label: 'VAT and payment terms',
    trail: ['Settings', 'Billing'],
    href: '/settings/billing#defaults-heading',
    keywords: ['vat', 'tax', 'due days', 'net 14', 'currency', 'quote validity'],
    anyOf: ['settings.billing.sensitive'],
  },
  {
    label: 'Late fees',
    trail: ['Settings', 'Billing'],
    href: '/settings/billing#late-fees-heading',
    keywords: ['interest', 'overdue', 'grace period', 'penalty'],
    anyOf: ['settings.billing.sensitive'],
  },
  {
    label: 'Document numbering',
    trail: ['Settings', 'Billing'],
    href: '/settings/billing#numbering-heading',
    keywords: ['prefix', 'invoice number', 'quote number', 'padding', 'UNB-INV'],
    anyOf: ['settings.billing.sensitive'],
  },
  {
    label: 'Logo',
    trail: ['Settings', 'Organisation'],
    href: '/settings/organisation#logo-heading',
    keywords: ['brand', 'letterhead', 'image'],
    anyOf: ['settings.manage'],
  },
  {
    label: 'Legal name and tax numbers',
    trail: ['Settings', 'Organisation'],
    href: '/settings/organisation#identity-heading',
    keywords: ['tin', 'vat number', 'address', 'registered', 'company name'],
    anyOf: ['settings.manage'],
  },
  {
    label: 'How long records are kept',
    trail: ['Settings', 'Organisation'],
    href: '/settings/organisation#records-heading',
    keywords: ['retention', 'delete', 'timezone', 'currency'],
    anyOf: ['settings.manage'],
  },
  {
    label: 'Pipeline stages',
    trail: ['Settings', 'Pipeline'],
    href: '/settings/pipeline#stages-heading',
    keywords: ['deal stages', 'probability', 'funnel'],
    anyOf: ['settings.manage'],
  },
  {
    label: 'Lost reasons',
    trail: ['Settings', 'Pipeline'],
    href: '/settings/pipeline#reasons-heading',
    keywords: ['why we lost', 'deal lost'],
    anyOf: ['settings.manage'],
  },
];

/** A settings section is a destination in its own right, under Settings. */
function settingsDestinations(): Destination[] {
  return SETTINGS_SECTIONS.map((section) => ({
    label: section.label,
    trail: ['Settings'],
    href: section.href,
    keywords: section.description
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((word) => word.length > 3),
    anyOf: section.anyOf,
    built: section.built,
  }));
}

/** Every page in the navigation, under the group it belongs to. */
function pageDestinations(sections: readonly NavSection[]): Destination[] {
  return sections.flatMap((section) =>
    section.items.map((item) => ({
      label: item.label,
      trail: section.label ? [section.label] : [],
      href: item.href,
      anyOf: item.anyOf,
      built: item.built,
    })),
  );
}

/** Everywhere this person could go, on this surface. Settings only exist on the studio side. */
export function destinationsFor(surface: Surface, sections: readonly NavSection[]): Destination[] {
  const pages = pageDestinations(sections);
  return surface === 'team' ? [...pages, ...settingsDestinations(), ...SETTINGS_DETAILS] : pages;
}

/** Where a destination came from, as one line: "Settings › Billing". */
export function trailLabel(destination: Destination): string {
  return destination.trail.join(' › ');
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Whether a destination answers what somebody typed. Every word has to appear somewhere — in the label, the trail or
 * the keywords — so "billing vat" narrows rather than widening, and a stray word never drags in the whole list.
 */
export function matches(destination: Destination, query: string): boolean {
  const words = normalise(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalise([destination.label, ...destination.trail, ...(destination.keywords ?? [])].join(' '));
  return words.every((word) => haystack.includes(word));
}

/**
 * The destinations this person can reach, best first. What decides it is how much of what somebody typed appears in
 * the name itself: "late fees" should reach the setting called Late fees, not the Billing page that merely mentions
 * it. Keywords are there to find a thing at all, never to outrank the thing actually named.
 */
export function search(
  destinations: readonly Destination[],
  query: string,
  permissions: readonly string[],
): Destination[] {
  const held = new Set(permissions);
  const allowed = destinations.filter(
    (destination) => !destination.anyOf || destination.anyOf.some((key) => held.has(key)),
  );
  const words = normalise(query).split(' ').filter(Boolean);
  const found = allowed.filter((destination) => matches(destination, query));
  if (words.length === 0) return found;

  const missedInLabel = (destination: Destination) => {
    const label = normalise(destination.label);
    return words.filter((word) => !label.includes(word)).length;
  };
  const opensWith = (destination: Destination) => (normalise(destination.label).startsWith(words[0]) ? 0 : 1);

  return found.sort(
    (a, b) =>
      missedInLabel(a) - missedInLabel(b) ||
      opensWith(a) - opensWith(b) ||
      a.trail.length - b.trail.length ||
      a.label.localeCompare(b.label),
  );
}
