'use node';

import { v } from 'convex/values';
import { internal } from './_generated/api';
import { internalAction } from './lib/functions';
import { renderStatementPdf } from './lib/renderDocumentPdf';
import { failureReason } from './lib/failures';

// Renders a statement PDF and keeps it on its statement row.

export const render = internalAction({
  args: { statementId: v.id('statements') },
  handler: async (ctx, { statementId }): Promise<null> => {
    try {
      const data = await ctx.runQuery(internal.statements.pdfData, { statementId });
      if (!data) return null;
      const pdf = new Uint8Array(await renderStatementPdf(data.payload));
      const storageId = await ctx.storage.store(new Blob([pdf], { type: 'application/pdf' }));
      await ctx.runMutation(internal.statements.attachPdf, { statementId, storageId });
    } catch (error) {
      await ctx.runMutation(internal.statements.attachPdf, {
        statementId,
        failure: failureReason(error, 'The statement could not be made'),
      });
    }
    return null;
  },
});
