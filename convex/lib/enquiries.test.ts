import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, labelFor, publicEnquirySchema, SERVICE_LABELS } from './enquiries';

describe('enquiry helpers', () => {
  it('allows exact origins and wildcard preview hosts only', () => {
    const allowed = ['https://unbuilt.studio', 'https://unbuilt-studio-web-*.vercel.app'];
    expect(isAllowedOrigin('https://unbuilt.studio', allowed)).toBe(true);
    expect(isAllowedOrigin('https://unbuilt-studio-web-git-main-abc.vercel.app', allowed)).toBe(true);
    expect(isAllowedOrigin('https://unbuilt.studio.evil.com', allowed)).toBe(false);
    expect(isAllowedOrigin('https://evil.com/https://unbuilt.studio', allowed)).toBe(false);
    expect(isAllowedOrigin('https://x.vercel.app', allowed)).toBe(false);
    expect(isAllowedOrigin('http://unbuilt.studio', allowed)).toBe(false);
    expect(isAllowedOrigin(null, allowed)).toBe(false);
  });

  it('validates the website form and normalises it', () => {
    const parsed = publicEnquirySchema.parse({
      services: ['web', 'web', 'design'],
      stage: '',
      budget: 'mid',
      name: ' Tolu ',
      email: ' Tolu@Glowhaus.CO ',
      company: '',
      turnstileToken: 't',
      extra: 'ignored',
    });
    expect(parsed).toEqual({
      services: ['web', 'design'],
      stage: undefined,
      budget: 'mid',
      timeline: undefined,
      about: undefined,
      name: 'Tolu',
      email: 'tolu@glowhaus.co',
      company: undefined,
      turnstileToken: 't',
    });
    expect(publicEnquirySchema.safeParse({ ...parsed, services: ['Web Platforms'] }).success).toBe(false);
    expect(labelFor(SERVICE_LABELS, 'web')).toBe('Web platforms');
    expect(labelFor(SERVICE_LABELS, 'ai')).toBe('ai');
  });
});
