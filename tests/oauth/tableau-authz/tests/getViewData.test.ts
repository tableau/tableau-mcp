import z from 'zod';

import { expect, test } from './base';
import { getSuperstoreWorkbook } from './testEnv';

// Skip until Content Exploration issues are resolved
test.describe.skip('get-view-data', () => {
  test('get view data', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const viewData = await client.callTool('get-view-data', {
      schema: z.string(),
      toolArgs: {
        viewId: superstore.defaultViewId,
      },
    });

    expect(viewData).toBeDefined();
  });
});
