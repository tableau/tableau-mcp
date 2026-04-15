import { z } from 'zod';

import { expect, test } from './base.js';
import { getSuperstoreWorkbook } from './testEnv.js';

test.describe('get-view-image', () => {
  test('get view image', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const viewImage = await client.callTool('get-view-image', {
      schema: z.string(),
      contentType: 'image',
      toolArgs: {
        viewId: superstore.defaultView.id,
      },
    });

    expect(viewImage).toBeDefined();
  });
});
