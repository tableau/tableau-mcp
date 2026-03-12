import z from 'zod';

import { viewSchema } from '../../../../src/sdks/tableau/types/view';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';

// Skip until Content Exploration issues are resolved
test.describe.skip('list-views', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('list views', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const views = await client.callTool('list-views', {
      schema: z.array(viewSchema),
      toolArgs: {},
    });

    expect(views.length).toBeGreaterThan(0);
    const view = views.find((view) => view.name === 'Overview');

    expect(view).toBeDefined();
  });
});
