import { z } from 'zod';

import { expect, test } from './base.js';
import { getSuperstoreWorkbook } from './testEnv.js';

test.describe('get-custom-view-data', () => {
  test('get custom view data', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const viewData = await client.callTool('get-custom-view-data', {
      schema: z.string(),
      toolArgs: {
        customViewId: superstore.defaultView.customViewId,
      },
    });

    expect(viewData).toBeDefined();
  });
});
