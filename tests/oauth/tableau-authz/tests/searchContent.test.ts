import z from 'zod';

import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';

test.describe('search-content', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('search content', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const searchResults = await client.callTool('search-content', {
      schema: z.array(z.record(z.string(), z.unknown())),
      toolArgs: {
        terms: 'superstore',
      },
    });

    expect(searchResults.length).toBeGreaterThan(0);

    const searchResultContentTypes = searchResults.map((result) => result.type);
    expect(searchResultContentTypes).toContain('workbook');
    expect(searchResultContentTypes).toContain('datasource');
  });
});
