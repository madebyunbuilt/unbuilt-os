import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';

const http = httpRouter();

// Better Auth at /api/auth/*. The Next.js app proxies these routes so cookies stay on its own hostnames.
authComponent.registerRoutes(http, createAuth);

export default http;
