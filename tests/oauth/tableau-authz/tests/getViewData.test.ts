import { z } from 'zod';

import { expect, test } from './base.js';
import { getSuperstoreWorkbook } from './testEnv.js';

const viewDataSchema = z.object({
  sheetName: z.string(),
  totalSheetsInView: z.number().int().positive(),
  columns: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  sheetStatus: z.enum(['OK', 'ERROR']),
  errorDetail: z.string().optional(),
});

test.describe('get-view-data', () => {
  test('get view data', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const viewData = await client.callTool('get-view-data', {
      schema: viewDataSchema,
      toolArgs: {
        viewId: superstore.defaultView.id,
      },
    });

    expect(viewData.sheetStatus).toBe('OK');
  });
});
