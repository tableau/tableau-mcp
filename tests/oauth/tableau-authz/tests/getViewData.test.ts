import { z } from 'zod';

import { expect, test } from './base.js';
import { getSuperstoreWorkbook } from './testEnv.js';

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
