import z from 'zod';

import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';
import { getSuperstoreWorkbook } from './testEnv';

test.describe('get-view-image', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('get view image', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

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
