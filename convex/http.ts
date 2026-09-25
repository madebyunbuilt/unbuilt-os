import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';
import { preflight, submit } from './enquiries';
import { download } from './files';
import * as paying from './paying';
import { inboundEmailWebhook } from './inboundEmail';
import { paystackWebhook } from './paystackWebhook';
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

// Paying an invoice by card (08-billing-and-finance.md, Paystack).
for (const step of ['view', 'start'] as const) {
  http.route({ path: `/public/pay/${step}`, method: 'POST', handler: paying[step] });
  http.route({ path: `/public/pay/${step}`, method: 'OPTIONS', handler: paying.preflight });
}
http.route({ path: '/webhooks/paystack', method: 'POST', handler: paystackWebhook });

// Mail sent to support@, turned into tickets (09-support-and-sla.md).
http.route({ path: '/webhooks/inbound-email', method: 'POST', handler: inboundEmailWebhook });

export default http;
