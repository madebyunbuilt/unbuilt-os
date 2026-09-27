import { describe, expect, it } from 'vitest';
import {
  asTyped,
  clientStatus,
  countryName,
  fromMentionMarkup,
  mentionSegments,
  splitTags,
  toMentionMarkup,
} from './crm-display';

describe('crm display', () => {
  it('shows leads as not built yet and closed clients as muted', () => {
    expect(clientStatus('lead')).toEqual({ label: 'Lead', tone: 'draft' });
    expect(clientStatus('active').tone).toBe('built');
    expect(clientStatus('archived').tone).toBe('muted');
    expect(splitTags(' retainer, , SaaS ')).toEqual(['retainer', 'SaaS']);
  });

  it('turns typed @mentions into markup and back', () => {
    const mentions = [
      { id: 'abc123', name: 'Dayo' },
      { id: 'def456', name: 'Dayo Ade' },
    ];
    const markup = toMentionMarkup('Thanks @Dayo Ade and @Dayo, email @Dayo-team is not a mention', mentions);
    expect(markup).toBe(
      'Thanks @[Dayo Ade](member:def456) and @[Dayo](member:abc123), email @Dayo-team is not a mention',
    );
    expect(fromMentionMarkup(markup)).toEqual({
      text: 'Thanks @Dayo Ade and @Dayo, email @Dayo-team is not a mention',
      mentions: [
        { id: 'def456', name: 'Dayo Ade' },
        { id: 'abc123', name: 'Dayo' },
      ],
    });
    // A mention removed from the text is not sent.
    expect(toMentionMarkup('No one here', mentions)).toBe('No one here');
  });

  it('splits a stored body for rendering', () => {
    expect(mentionSegments('Ask @[Kemi Bello](member:k1) today')).toEqual([
      { kind: 'text', text: 'Ask ' },
      { kind: 'mention', name: 'Kemi Bello' },
      { kind: 'text', text: ' today' },
    ]);
  });
});

describe('values a person has to read', () => {
  it('names a country rather than showing its code', () => {
    // NG in a column of readable fields looks like a mistake, or like a field nobody filled in properly.
    expect(countryName('NG')).toBe('Nigeria');
    expect(countryName('gb')).toBe('United Kingdom');
    expect(countryName('US')).toBe('United States');
  });

  it('shows an unknown code as it was typed, rather than swallowing it', () => {
    // Better somebody sees ZZ and corrects it than sees nothing and assumes the field is empty.
    expect(countryName('ZZ')).toBe('ZZ');
    expect(countryName(undefined)).toBeUndefined();
  });

  it('lifts the first letter of something somebody typed, and changes nothing else', () => {
    expect(asTyped('referral')).toBe('Referral');
    // The rest is theirs: a source of "referral from Bayo at Kuda" keeps its own words.
    expect(asTyped('referral from Bayo at Kuda')).toBe('Referral from Bayo at Kuda');
    expect(asTyped('LinkedIn')).toBe('LinkedIn');
    expect(asTyped('  ')).toBeUndefined();
    expect(asTyped(undefined)).toBeUndefined();
  });
});
