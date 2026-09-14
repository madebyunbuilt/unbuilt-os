import { authServer } from '@/lib/auth-server';

// Better Auth runs in Convex. Proxying it here keeps its cookies on os.* and portal.* rather than on Convex's domain.
export const GET = (request: Request) => authServer().handler.GET(request);
export const POST = (request: Request) => authServer().handler.POST(request);
