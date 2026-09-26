import { afterEach, describe, expect, it, vi } from 'vitest';
import { senderFor } from './senders';

// Who an email comes from (14-platform.md, Email). The point of three addresses is that a reply goes somewhere a
// person or a webhook is actually reading.

afterEach(() => vi.unstubAllEnvs());

describe('the from line', () => {
  it('puts each kind of mail on its own mailbox, keeping the studio’s name and domain', () => {
    vi.stubEnv('AUTH_EMAIL_FROM', 'Unbuilt OS <notifications@unbuilt.studio>');
    expect(senderFor('notifications')).toBe('Unbuilt OS <notifications@unbuilt.studio>');
    expect(senderFor('billing')).toBe('Unbuilt OS <billing@unbuilt.studio>');
    expect(senderFor('support')).toBe('Unbuilt OS <support@unbuilt.studio>');
  });

  it('leaves a sandbox address alone, rather than inventing a mailbox that does not exist', () => {
    vi.stubEnv('AUTH_EMAIL_FROM', 'Unbuilt OS <onboarding@resend.dev>');
    expect(senderFor('billing')).toBe('Unbuilt OS <onboarding@resend.dev>');
  });

  it('lets one sender be set by hand without disturbing the others', () => {
    vi.stubEnv('AUTH_EMAIL_FROM', 'Unbuilt OS <notifications@unbuilt.studio>');
    vi.stubEnv('EMAIL_FROM_BILLING', 'Unbuilt Finance <accounts@unbuilt.studio>');
    expect(senderFor('billing')).toBe('Unbuilt Finance <accounts@unbuilt.studio>');
    expect(senderFor('support')).toBe('Unbuilt OS <support@unbuilt.studio>');
  });
});
