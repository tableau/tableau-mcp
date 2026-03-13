import z from 'zod';

import { expect, test } from './base';
import { getSuperstoreWorkbook } from './testEnv';

test.describe('get-view-image', () => {
  test('get view image', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const viewImage = await client.callTool('get-view-image', {
      schema: z.string(),
      contentType: 'image',
      toolArgs: {
        viewId: superstore.defaultViewId,
      },
    });

    expect(viewImage).toBeDefined();
  });
});
