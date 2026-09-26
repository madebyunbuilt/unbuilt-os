import { describe, expect, it } from 'vitest';
import { destinationsFor, search, trailLabel } from './destinations';
import { navigationFor } from './navigation';
import { PORTAL_PERMISSIONS, TEAM_PERMISSIONS } from '@/convex/lib/permissions';

// Searching everywhere a person can go (14-platform.md). The point of it: something buried inside a page can be
// found by what it is called, not by remembering which page holds it.

const everything: string[] = [...TEAM_PERMISSIONS, ...PORTAL_PERMISSIONS];
const studio = () => destinationsFor('team', navigationFor('team', everything));
const portal = () => destinationsFor('portal', navigationFor('portal', everything));

describe('finding a setting by its own name', () => {
  it('finds the VAT rate, which no page is called', () => {
    const [best] = search(studio(), 'vat', everything);
    expect(best.href).toBe('/settings/billing#defaults-heading');
    expect(trailLabel(best)).toBe('Settings › Billing');
  });

  it('finds bank details by what somebody would call them', () => {
    for (const typed of ['bank', 'account number', 'iban', 'payment details']) {
      const [best] = search(studio(), typed, everything);
      expect(best.href, typed).toBe('/settings/billing#bank-heading');
    }
  });

  it('prefers the page named after the word over everything related to it', () => {
    const [best] = search(studio(), 'invoices', everything);
    // Typing "invoices" wants the Invoices page, not the invoice numbering setting.
    expect(best.label).toBe('Invoices');
  });

  it('narrows as more words are typed, rather than widening', () => {
    const one = search(studio(), 'settings', everything);
    const two = search(studio(), 'settings late fees', everything);
    expect(two.length).toBeLessThan(one.length);
    expect(two[0].href).toBe('/settings/billing#late-fees-heading');
  });

  it('matches on the trail, so somebody can search where a thing lives', () => {
    const found = search(studio(), 'pipeline stages', everything);
    expect(found[0].href).toBe('/settings/pipeline#stages-heading');
  });

  it('finds nothing for words nobody used', () => {
    expect(search(studio(), 'aardvark', everything)).toEqual([]);
  });
});

describe('what a person is allowed to find', () => {
  it('hides a setting whose permission they do not hold', () => {
    // Bank details are settings.billing.sensitive; somebody without it should not even learn the page exists.
    const withoutBilling = everything.filter((key) => key !== 'settings.billing.sensitive');
    const found = search(studio(), 'bank', withoutBilling);
    expect(found.every((destination) => !destination.href.includes('bank-heading'))).toBe(true);
  });

  it('offers a client only their own surface', () => {
    const found = search(portal(), 'settings', everything);
    // Settings belong to the studio; the portal has no such thing to find.
    expect(found).toEqual([]);
    expect(search(portal(), 'invoices', everything)[0].href).toBe('/invoices');
  });
});
