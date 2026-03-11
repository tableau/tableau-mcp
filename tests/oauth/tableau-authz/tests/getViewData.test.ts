import z from 'zod';

import { viewSchema } from '../../../../src/sdks/tableau/types/view';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';

test.describe('getViewData', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('get view data', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const views = await client.callTool('list-views', {
      schema: z.array(viewSchema),
    });

    expect(views.length).toBeGreaterThan(0);

    const viewData = await client.callTool('get-view-data', {
      schema: z.string(),
      toolArgs: {
        viewId: views[0].id,
      },
    });

    expect(viewData).toBeDefined();
  });
});
