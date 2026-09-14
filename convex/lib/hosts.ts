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
