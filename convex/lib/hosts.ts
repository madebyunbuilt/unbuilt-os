// The hostnames a deployment serves (AUTH_ALLOWED_HOSTS) and the app's own address, shared by sign-in and emails.

/** Hostnames this deployment serves, e.g. "os.unbuilt.studio,portal.unbuilt.studio". Wildcards allowed for previews. */
export function allowedHosts(): string[] {
  return (process.env.AUTH_ALLOWED_HOSTS ?? 'localhost:3000,portal.localhost:3000')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

export const isLocalHost = (host: string) =>
  host === 'localhost' || host.startsWith('localhost:') || /\.localhost(:\d+)?$/.test(host);

export const originOf = (host: string) => `${isLocalHost(host) ? 'http' : 'https'}://${host}`;

/** The first exact (non-wildcard, non-portal) host: the team app's address. */
export function primaryAppHost(hosts: string[] = allowedHosts()): string | undefined {
  return hosts.find((host) => !host.includes('*') && !host.startsWith('portal.'));
}

/** Where links in team emails point. APP_URL wins; otherwise the primary allowed host. */
export function teamAppOrigin(): string | undefined {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  const host = primaryAppHost();
  return host ? originOf(host) : undefined;
}

/** Where links in client emails point. PORTAL_URL wins; otherwise the first exact portal host. */
export function portalAppOrigin(): string | undefined {
  const configured = process.env.PORTAL_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  const host = allowedHosts().find((candidate) => !candidate.includes('*') && candidate.startsWith('portal.'));
  return host ? originOf(host) : undefined;
}

/**
 * Moves a sign-in link to the app the account belongs to: clients to the portal, team members to the team app. Better
 * Auth builds the link from the host that asked for it, so a client who typed their email into the team sign-in page
 * would otherwise be sent somewhere they cannot use. The token and its query are kept exactly as they were; a
 * deployment with no address configured for that surface keeps the original link rather than losing the sign-in.
 */
export function signInLinkFor(url: string, kind: 'team' | 'client'): string {
  const origin = kind === 'client' ? portalAppOrigin() : teamAppOrigin();
  if (!origin) return url;
  try {
    const link = new URL(url);
    return new URL(`${link.pathname}${link.search}${link.hash}`, origin).toString();
  } catch {
    return url;
  }
}
