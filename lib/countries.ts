// The countries a client can be in (05-crm.md, Clients). Only the codes are kept here; the names come from Intl, so
// there is no table of translations to maintain and no chance of the two drifting apart.

const ISO_3166_ALPHA2 =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
  'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE ' +
  'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO ' +
  'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW ' +
  'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
  'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW';

export type Country = { code: string; name: string };

/** Every country, by name, with the studio's own first: most clients are in Nigeria, and scrolling to N is a chore. */
export const COUNTRIES: readonly Country[] = (() => {
  const names = new Intl.DisplayNames(['en-GB'], { type: 'region', fallback: 'code' });
  const all = ISO_3166_ALPHA2.split(' ')
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const nigeria = all.find((country) => country.code === 'NG');
  return nigeria ? [nigeria, ...all.filter((country) => country.code !== 'NG')] : all;
})();

/** Whether a code is one a person could have meant. `SP` is not a country: Spain is `ES`. */
export function isCountryCode(code: string): boolean {
  return COUNTRIES.some((country) => country.code === code.toUpperCase());
}
