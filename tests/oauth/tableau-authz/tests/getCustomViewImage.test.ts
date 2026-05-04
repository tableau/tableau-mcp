import { z } from 'zod';

import { expect, test } from './base.js';
import { getSuperstoreWorkbook } from './testEnv.js';

test.describe('get-custom-view-image', () => {
  test('get custom view image', async ({ client }) => {
    const superstore = getSuperstoreWorkbook();

    const viewImage = await client.callTool('get-custom-view-image', {
      schema: z.string(),
      contentType: 'image',
      toolArgs: {
        customViewId: superstore.defaultView.customViewId,
      },
    });

    expect(viewImage).toBeDefined();
  });
});
