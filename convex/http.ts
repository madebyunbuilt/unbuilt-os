import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { preflight, submit } from './enquiries';
import { download } from './files';
import * as signing from './signing';

const http = httpRouter();

// Better Auth at /api/auth/*. The Next.js app proxies these routes so cookies stay on its own hostnames.
authComponent.registerRoutes(http, createAuth);

// Signed, short-lived file downloads (convex/files.ts).
http.route({ path: '/files/download', method: 'GET', handler: download });

// The website's enquiry form (13-cms-and-website.md, Enquiries).
http.route({ path: '/public/enquiries', method: 'POST', handler: submit });
http.route({ path: '/public/enquiries', method: 'OPTIONS', handler: preflight });

// The signing page behind /sign/[token] (07-documents-and-esign.md, The signing ceremony).
for (const step of ['view', 'code', 'verify', 'upload', 'sign', 'decline'] as const) {
  http.route({ path: `/public/sign/${step}`, method: 'POST', handler: signing[step] });
  http.route({ path: `/public/sign/${step}`, method: 'OPTIONS', handler: signing.preflight });
}

export default http;
