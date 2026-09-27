import { describe, expect, it } from 'vitest';
import { COUNTRIES, isCountryCode } from './countries';
import { countryName } from './crm-display';

// Countries (05-crm.md). A two-letter code typed by hand is a guess; the point of a list is that nobody has to guess.

describe('the country list', () => {
  it('puts the studio’s own country first, then the rest by name', () => {
    expect(COUNTRIES[0]).toMatchObject({ code: 'NG', name: 'Nigeria' });
    const rest = COUNTRIES.slice(1).map((country) => country.name);
    expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b)));
  });

  it('holds the countries a Nigerian studio actually bills', () => {
    const byCode = new Map(COUNTRIES.map((country) => [country.code, country.name]));
    expect(byCode.get('NG')).toBe('Nigeria');
    expect(byCode.get('GB')).toBe('United Kingdom');
    expect(byCode.get('US')).toBe('United States');
    expect(byCode.get('ES')).toBe('Spain');
    expect(byCode.get('ZA')).toBe('South Africa');
  });

  it('knows a code somebody could have meant from one they could not', () => {
    expect(isCountryCode('ng')).toBe(true);
    expect(isCountryCode('ES')).toBe(true);
    // The whole reason for the list: SP looks like Spain and is not a country at all.
    expect(isCountryCode('SP')).toBe(false);
    expect(isCountryCode('ZZ')).toBe(false);
  });

  it('agrees with how a country is shown', () => {
    for (const country of COUNTRIES.slice(0, 40)) {
      expect(countryName(country.code)).toBe(country.name);
    }
  });
});
