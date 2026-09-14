import { describe, expect, it } from 'vitest';
import {
  canMessageOnWhatsapp,
  lineUnitPrice,
  mentionedMemberIds,
  plainMentions,
  tags,
  unitPriceFor,
  website,
} from './crm';

describe('crm helpers', () => {
  it('reads @mentions from note bodies', () => {
    const body =
      'Thanks @[Dayo Ade](member:abc123) and @[Kemi](member:def456), cc @[Dayo Ade](member:abc123). Not @Tobi';
    expect(mentionedMemberIds(body)).toEqual(['abc123', 'def456']);
    expect(plainMentions(body)).toBe('Thanks @Dayo Ade and @Kemi, cc @Dayo Ade. Not @Tobi');
  });

  it('normalises websites and tags', () => {
    expect(website('glossup.com/')).toBe('https://glossup.com');
    expect(website('http://qravit.io/about')).toBe('http://qravit.io/about');
    expect(website(' ')).toBeUndefined();
    expect(() => website('not a site')).toThrow(/not a website/);
    expect(tags([' SaaS', 'saas', '', 'Retainer'])).toEqual(['saas', 'retainer']);
  });

  it('never converts a rate card price: without one in the document currency a manual price is required', () => {
    const item = {
      name: 'Design day',
      active: true,
      prices: [{ currency: 'NGN' as const, unitPriceMinor: 45_000_000 }],
    };
    expect(unitPriceFor(item, 'NGN')).toBe(45_000_000);
    expect(unitPriceFor(item, 'USD')).toBeNull();
    expect(lineUnitPrice(item, 'NGN')).toBe(45_000_000);
    expect(() => lineUnitPrice(item, 'USD')).toThrow(/no USD price/);
    expect(lineUnitPrice(item, 'USD', 60_000)).toBe(60_000);
    // The document's own price overrides the rate card.
    expect(lineUnitPrice(item, 'NGN', 40_000_000)).toBe(40_000_000);
    expect(() => lineUnitPrice({ ...item, active: false }, 'NGN')).toThrow(/no longer offered/);
    expect(() => lineUnitPrice(item, 'USD', -1)).toThrow(/non-negative/);
  });

  it('allows WhatsApp only to active contacts with a number and recorded opt-in', () => {
    const optIn = { at: 1, method: 'written_consent' as const };
    expect(canMessageOnWhatsapp({ status: 'active', whatsapp: '+2348012345678', whatsappOptIn: optIn })).toBe(true);
    expect(canMessageOnWhatsapp({ status: 'active', whatsapp: '+2348012345678', whatsappOptIn: undefined })).toBe(
      false,
    );
    expect(canMessageOnWhatsapp({ status: 'active', whatsapp: undefined, whatsappOptIn: optIn })).toBe(false);
    expect(canMessageOnWhatsapp({ status: 'left', whatsapp: '+2348012345678', whatsappOptIn: optIn })).toBe(false);
  });
});
