import { v } from 'convex/values';
import { type Doc, type Id } from './_generated/dataModel';
import { type QueryCtx } from './_generated/server';
import { portalQuery } from './lib/functions';
import { OPEN_STATUSES, TYPE_LABELS as INVOICE_TYPE_LABELS } from './lib/invoices';
import { TYPE_LABELS as DOCUMENT_TYPE_LABELS } from './lib/documents';
import { type ClientPrincipal } from './lib/principals';

// The client portal's home (12-client-portal.md, Navigation). What needs the client's attention, and the projects
// they have running. Every read here is filtered to the signed-in contact's own client: the portal wrappers put that
// client on the principal, and nothing in this file reads anything that is not theirs.

/** Documents a client is being asked to do something about. */
const AWAITING_CLIENT: ReadonlySet<Doc<'documents'>['status']> = new Set([
  'sent',
  'viewed',
  'awaiting_signature',
  'partially_signed',
]);

/** Quotes and proposals are accepted; everything else of these is signed. */
const ACCEPTED_TYPES: ReadonlySet<Doc<'documents'>['type']> = new Set(['quote', 'proposal']);

async function clientProjects(ctx: QueryCtx, clientId: Id<'clients'>) {
  const projects = await ctx.db
    .query('projects')
    .withIndex('by_client', (q) => q.eq('clientId', clientId))
    .collect();
  // A client is not shown work that has been archived or called off.
  return projects.filter((project) => project.status !== 'archived' && project.status !== 'cancelled');
}

/**
 * What is waiting on the client, in the order they would care about it: money, then decisions, then reading. Each
 * entry names where to go, so the home page never needs to know how a thing is addressed.
 */
export const home = portalQuery(null)({
  args: {},
  handler: async (ctx) => {
    const principal = ctx.principal as ClientPrincipal;
    const clientId = principal.clientId;
    const [client, projects] = await Promise.all([ctx.db.get('clients', clientId), clientProjects(ctx, clientId)]);
    const projectIds = new Set(projects.map((project) => project._id));

    const waiting: {
      kind: 'invoice' | 'document' | 'deliverable' | 'changeRequest';
      id: string;
      title: string;
      detail: string;
      href: string;
    }[] = [];

    if (principal.permissions.has('portal.invoices.view')) {
      const invoices = await ctx.db
        .query('invoices')
        .withIndex('by_client_status', (q) => q.eq('clientId', clientId))
        .collect();
      for (const invoice of invoices) {
        if (!OPEN_STATUSES.has(invoice.status) || invoice.balanceMinor <= 0) continue;
        waiting.push({
          kind: 'invoice',
          id: invoice._id,
          title: `${INVOICE_TYPE_LABELS[invoice.type]} ${invoice.number ?? ''}`.trim(),
          detail: invoice.dueDate ? `Due ${invoice.dueDate}` : 'Due',
          href: `/invoices/${invoice._id}`,
        });
      }
    }

    if (principal.permissions.has('portal.documents.view')) {
      const documents = await ctx.db
        .query('documents')
        .withIndex('by_client', (q) => q.eq('clientId', clientId))
        .collect();
      for (const document of documents) {
        if (!AWAITING_CLIENT.has(document.status)) continue;
        waiting.push({
          kind: 'document',
          id: document._id,
          title: `${DOCUMENT_TYPE_LABELS[document.type]} ${document.number ?? ''}`.trim(),
          detail: ACCEPTED_TYPES.has(document.type) ? 'Waiting for your decision' : 'Waiting for your signature',
          href: `/documents/${document._id}`,
        });
      }
    }

    if (principal.permissions.has('portal.deliverables.approve')) {
      for (const project of projects) {
        const deliverables = await ctx.db
          .query('deliverables')
          .withIndex('by_project', (q) => q.eq('projectId', project._id))
          .collect();
        for (const deliverable of deliverables) {
          if (deliverable.status !== 'in_review') continue;
          waiting.push({
            kind: 'deliverable',
            id: deliverable._id,
            title: deliverable.title,
            detail: `${project.name} · waiting for your review`,
            href: `/projects/${project._id}`,
          });
        }
      }
    }

    if (principal.permissions.has('portal.changerequests.approve')) {
      for (const project of projects) {
        const changeRequests = await ctx.db
          .query('changeRequests')
          .withIndex('by_project_status', (q) => q.eq('projectId', project._id).eq('status', 'sent'))
          .collect();
        for (const changeRequest of changeRequests) {
          waiting.push({
            kind: 'changeRequest',
            id: changeRequest._id,
            title: `${changeRequest.number ?? 'Change request'}: ${changeRequest.title}`,
            detail: `${project.name} · waiting for your decision`,
            href: `/projects/${project._id}`,
          });
        }
      }
    }

    const summaries = await Promise.all(
      projects
        .filter((project) => project.status !== 'completed')
        .map(async (project) => {
          const milestones = await ctx.db
            .query('milestones')
            .withIndex('by_project_order', (q) => q.eq('projectId', project._id))
            .collect();
          const done = milestones.filter(
            (milestone) => milestone.status === 'approved' || milestone.status === 'invoiced',
          );
          const next = milestones.find(
            (milestone) =>
              milestone.status !== 'approved' && milestone.status !== 'invoiced' && milestone.status !== 'skipped',
          );
          return {
            id: project._id,
            code: project.code,
            name: project.name,
            status: project.status,
            // No budget, no cost, no rates: none of that is the client's (12-client-portal.md, Rules).
            milestones: { done: done.length, total: milestones.length },
            nextMilestone: next ? { name: next.name, dueDate: next.dueDate } : null,
          };
        }),
    );

    return {
      clientName: client?.displayName ?? '',
      contactName: principal.contact.name,
      waiting,
      projects: summaries.sort((a, b) => a.code.localeCompare(b.code)),
      // So the page can say "nothing needs you" rather than showing an empty list with no explanation.
      projectsHidden: projectIds.size === 0,
    };
  },
});

/** The client's own projects, for the portal's Projects page. */
export const projects = portalQuery('portal.projects.view')({
  args: {},
  handler: async (ctx) => {
    const principal = ctx.principal as ClientPrincipal;
    const rows = await clientProjects(ctx, principal.clientId);
    return await Promise.all(
      rows.map(async (project) => {
        const milestones = await ctx.db
          .query('milestones')
          .withIndex('by_project_order', (q) => q.eq('projectId', project._id))
          .collect();
        const done = milestones.filter(
          (milestone) => milestone.status === 'approved' || milestone.status === 'invoiced',
        );
        return {
          id: project._id,
          code: project.code,
          name: project.name,
          status: project.status,
          startDate: project.startDate,
          dueDate: project.dueDate,
          milestones: { done: done.length, total: milestones.length },
        };
      }),
    );
  },
});

/** One of the client's projects: its milestones, and nothing internal. */
export const project = portalQuery('portal.projects.view')({
  args: { projectId: v.id('projects') },
  handler: async (ctx, { projectId }) => {
    const principal = ctx.principal as ClientPrincipal;
    const found = await ctx.db.get('projects', projectId);
    // Another client's project is not found, rather than refused: nothing says it exists.
    if (!found || found.clientId !== principal.clientId || found.status === 'archived') return null;
    const milestones = await ctx.db
      .query('milestones')
      .withIndex('by_project_order', (q) => q.eq('projectId', projectId))
      .collect();
    return {
      id: found._id,
      code: found.code,
      name: found.name,
      status: found.status,
      startDate: found.startDate,
      dueDate: found.dueDate,
      milestones: milestones.map((milestone) => ({
        id: milestone._id,
        name: milestone.name,
        status: milestone.status,
        dueDate: milestone.dueDate,
      })),
    };
  },
});
