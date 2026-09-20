import { authServer } from '@/lib/auth-server';
import { onRequestedHost } from '@/lib/forwarded-host';

// Better Auth runs in Convex. Proxying it here keeps its cookies on os.* and portal.* rather than on Convex's domain,
// and onRequestedHost makes sure the host the browser used is the host Better Auth builds its redirects from.
export const GET = (request: Request) => authServer().handler.GET(onRequestedHost(request));
export const POST = (request: Request) => authServer().handler.POST(onRequestedHost(request));
