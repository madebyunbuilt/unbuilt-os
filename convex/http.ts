import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { preflight, submit } from './enquiries';
import { download } from './files';

const http = httpRouter();

// Better Auth at /api/auth/*. The Next.js app proxies these routes so cookies stay on its own hostnames.
authComponent.registerRoutes(http, createAuth);

// Signed, short-lived file downloads (convex/files.ts).
http.route({ path: '/files/download', method: 'GET', handler: download });

// The website's enquiry form (13-cms-and-website.md, Enquiries).
http.route({ path: '/public/enquiries', method: 'POST', handler: submit });
http.route({ path: '/public/enquiries', method: 'OPTIONS', handler: preflight });

export default http;
