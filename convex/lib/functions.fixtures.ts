import { v } from 'convex/values';
import { portalMutation, portalQuery, sessionQuery, teamAction, teamMutation, teamQuery } from './functions';

// Functions that exist only for convex/lib/functions.test.ts. Convex skips files with more than one dot when deploying,
// so none of these reach a real deployment.

export const teamRead = teamQuery('clients.view')({
  args: {},
  handler: async (ctx) => ({ memberId: ctx.principal.member._id, canDelete: ctx.can('clients.delete') }),
});

export const teamRename = teamMutation('clients.update')({
  args: { clientId: v.id('clients'), displayName: v.string() },
  handler: async (ctx, { clientId, displayName }) => {
    await ctx.db.patch('clients', clientId, { displayName });
  },
});

export const teamCreateThenDelete = teamMutation('clients.create')({
  args: {},
  handler: async (ctx) => {
    const clientId = await ctx.db.insert('clients', {
      displayName: 'Temporary',
      kind: 'company',
      status: 'lead',
      defaultCurrency: 'NGN',
      timezone: 'Africa/Lagos',
      portalEnabled: false,
    });
    await ctx.db.delete(clientId);
    return clientId;
  },
});

export const teamSetCostRate = teamMutation('team.manage')({
  args: { memberId: v.id('teamMembers'), costRateMinor: v.number() },
  handler: async (ctx, { memberId, costRateMinor }) => {
    await ctx.db.patch(memberId, { costRateMinor });
  },
});

export const teamTamperWithAudit = teamMutation('clients.update')({
  args: { entryId: v.optional(v.id('auditLog')) },
  handler: async (ctx, { entryId }) => {
    if (entryId) {
      await ctx.db.delete(entryId);
    } else {
      await ctx.db.insert('auditLog', {
        actorKind: 'system',
        action: 'insert',
        table: 'clients',
        recordId: 'forged',
        diff: {},
        at: 0,
      });
    }
  },
});

export const teamActionRead = teamAction('clients.view')({
  args: {},
  handler: async (ctx) => ({ memberId: ctx.principal.memberId, roleKey: ctx.principal.roleKey }),
});

export const portalOwnClient = portalQuery('portal.projects.view')({
  args: {},
  handler: async (ctx) => (await ctx.db.get('clients', ctx.clientId))?.displayName ?? null,
});

export const portalContact = portalQuery('portal.projects.view')({
  args: { contactId: v.id('contacts') },
  handler: async (ctx, { contactId }) => ctx.ownedByClient(await ctx.db.get('contacts', contactId))?.name ?? null,
});

export const portalInvoicesOnly = portalQuery('portal.invoices.view')({
  args: {},
  handler: async () => 'invoices',
});

export const portalSetJobTitle = portalMutation('portal.files.upload')({
  args: { jobTitle: v.string() },
  handler: async (ctx, { jobTitle }) => {
    await ctx.db.patch('contacts', ctx.principal.contact._id, { jobTitle });
  },
});

export const whoAmI = sessionQuery({
  args: {},
  handler: async (ctx) => ctx.session.email,
});
