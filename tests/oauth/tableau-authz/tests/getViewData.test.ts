import { viewDataSheetResultSchema } from '../../../../src/tools/web/views/getViewData.js';
import { expect, test } from './base.js';
import { getSuperstoreWorkbook } from './testEnv.js';

test.describe('get-view-data', () => {
  test('get view data', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const viewData = await client.callTool('get-view-data', {
      schema: viewDataSheetResultSchema,
      toolArgs: {
        viewId: superstore.defaultView.id,
      },
    });

    expect(viewData.sheetStatus).toBe('OK');
  });
});
