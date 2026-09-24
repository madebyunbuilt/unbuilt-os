import { v } from 'convex/values';
import { internal } from './_generated/api';
import { getClient } from './lib/crm';
import { recordUpload } from './lib/files';
import { internalMutation, internalQuery, teamMutation, teamQuery } from './lib/functions';
import { getOrgSettings } from './lib/settings';
import { buildStatement, checkedRange } from './lib/statements';
import { type StatementPdfPayload } from '../pdf/types';

// Client statements of account (08-billing-and-finance.md, Statements). The team reads one on screen for any range, or
// asks for the PDF, which an action renders and keeps. The portal view arrives with the client portal (step 10).

export const forClient = teamQuery('invoices.view')({
  args: { clientId: v.id('clients'), fromDate: v.string(), toDate: v.string() },
  handler: async (ctx, { clientId, fromDate, toDate }) => {
    await getClient(ctx, clientId);
    checkedRange(fromDate, toDate);
    return await buildStatement(ctx, clientId, fromDate, toDate);
  },
});

export const listPdfs = teamQuery('invoices.view')({
  args: { clientId: v.id('clients') },
  handler: async (ctx, { clientId }) => {
    const rows = await ctx.db
      .query('statements')
      .withIndex('by_client', (q) => q.eq('clientId', clientId))
      .order('desc')
      .take(20);
    return rows.map((row) => ({
      id: row._id,
      fromDate: row.fromDate,
      toDate: row.toDate,
      status: row.status,
      fileId: row.fileId,
      failure: row.failure,
      createdAt: row._creationTime,
    }));
  },
});

export const requestPdf = teamMutation('invoices.view')({
  args: { clientId: v.id('clients'), fromDate: v.string(), toDate: v.string() },
  handler: async (ctx, { clientId, fromDate, toDate }) => {
    await getClient(ctx, clientId);
    checkedRange(fromDate, toDate);
    const statementId = await ctx.db.insert('statements', {
      clientId,
      fromDate,
      toDate,
      status: 'rendering',
      requestedByMemberId: ctx.principal.member._id,
    });
    await ctx.scheduler.runAfter(0, internal.statementRendering.render, { statementId });
    return statementId;
  },
});

export const pdfData = internalQuery({
  args: { statementId: v.id('statements') },
  handler: async (ctx, { statementId }) => {
    const row = await ctx.db.get('statements', statementId);
    if (!row) return null;
    const [settings, client] = await Promise.all([getOrgSettings(ctx), ctx.db.get('clients', row.clientId)]);
    const name = settings.legalName ?? settings.tradingName ?? 'Unbuilt Studio';
    const payload: StatementPdfPayload = {
      org: {
        name,
        addressLines: settings.addressLines,
        email: settings.email,
        tin: settings.tin,
        vatNumber: settings.vatNumber,
      },
      client: {
        name: client?.legalName ?? client?.displayName ?? 'Client',
        addressLines: client?.addressLines ?? [],
        tin: client?.tin,
      },
      brand: { primary: settings.brand.primary },
      fromDate: row.fromDate,
      toDate: row.toDate,
      sections: (await buildStatement(ctx, row.clientId, row.fromDate, row.toDate)).map((section) => ({
        currency: section.currency,
        openingMinor: section.openingMinor,
        closingMinor: section.closingMinor,
        lines: section.lines.map(({ date, description, debitMinor, creditMinor, balanceMinor }) => ({
          date,
          description,
          debitMinor,
          creditMinor,
          balanceMinor,
        })),
      })),
      createdAtMs: row._creationTime,
    };
    return { payload, fileName: `statement-${client?.displayName ?? 'client'}-${row.fromDate}-${row.toDate}.pdf` };
  },
});

export const attachPdf = internalMutation({
  args: { statementId: v.id('statements'), storageId: v.optional(v.id('_storage')), failure: v.optional(v.string()) },
  handler: async (ctx, { statementId, storageId, failure }) => {
    const row = await ctx.db.get('statements', statementId);
    if (!row) return;
    if (!storageId) {
      await ctx.db.patch('statements', statementId, { status: 'failed', failure: failure?.slice(0, 300) });
      return;
    }
    const upload = await recordUpload(ctx, {
      storageId,
      name: `statement-${row.fromDate}-${row.toDate}.pdf`,
      contentType: 'application/pdf',
      context: 'document',
      owner: { table: 'statements', id: statementId },
      visibility: 'client',
      clientId: row.clientId,
      uploadedBy: { kind: 'team', id: row.requestedByMemberId },
    });
    await ctx.db.patch(
      'statements',
      statementId,
      upload.ok ? { status: 'ready', fileId: upload.fileId } : { status: 'failed', failure: upload.message },
    );
  },
});
