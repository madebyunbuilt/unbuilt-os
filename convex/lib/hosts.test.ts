import { beforeEach, describe, expect, it } from 'vitest';
import { signInLinkFor } from './hosts';

// Sign-in links must land in the app the account belongs to, whichever host asked for them.

const VERIFY = '/api/auth/magic-link/verify?token=abc&callbackURL=%2F';
const fromTeamHost = `http://localhost:3000${VERIFY}`;
const fromPortalHost = `http://portal.localhost:3000${VERIFY}`;

beforeEach(() => {
  delete process.env.AUTH_ALLOWED_HOSTS;
  delete process.env.APP_URL;
  delete process.env.PORTAL_URL;
});

describe('signInLinkFor', () => {
  it('sends a client to the portal, token and all', () => {
    expect(signInLinkFor(fromTeamHost, 'client')).toBe(`http://portal.localhost:3000${VERIFY}`);
  });

  it('sends a team member to the team app', () => {
    expect(signInLinkFor(fromPortalHost, 'team')).toBe(`http://localhost:3000${VERIFY}`);
  });

  it('leaves a link that is already on the right app alone', () => {
    expect(signInLinkFor(fromPortalHost, 'client')).toBe(fromPortalHost);
    expect(signInLinkFor(fromTeamHost, 'team')).toBe(fromTeamHost);
  });

  it('follows PORTAL_URL and APP_URL when they are set', () => {
    process.env.PORTAL_URL = 'https://portal.unbuilt.studio';
    process.env.APP_URL = 'https://os.unbuilt.studio';
    expect(signInLinkFor(fromTeamHost, 'client')).toBe(`https://portal.unbuilt.studio${VERIFY}`);
    expect(signInLinkFor(fromPortalHost, 'team')).toBe(`https://os.unbuilt.studio${VERIFY}`);
  });

  it('keeps the original link rather than losing a sign-in when that surface has no address', () => {
    // A deployment that serves the team app only.
    process.env.AUTH_ALLOWED_HOSTS = 'os.unbuilt.studio';
    expect(signInLinkFor(fromTeamHost, 'client')).toBe(fromTeamHost);
  });
});
