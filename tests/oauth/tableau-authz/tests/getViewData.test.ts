import { z } from 'zod';

import { getSuperstoreWorkbook } from '../../../testEnv.js';
import { expect, test } from './base.js';

test.describe('get-view-data', () => {
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
