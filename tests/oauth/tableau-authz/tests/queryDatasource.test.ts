import z from 'zod';

import { queryOutputSchema } from '../../../../src/sdks/tableau/apis/vizqlDataServiceApi';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';
import { getSuperstoreDatasource } from './testEnv';

test.describe('query-datasource', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('query datasource', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const superstore = getSuperstoreDatasource();

    const { data } = await client.callTool('query-datasource', {
      schema: queryOutputSchema,
      toolArgs: {
        datasourceLuid: superstore.id,
        query: { fields: [{ fieldCaption: 'Postal Code' }] },
      },
    });

    const postalCodes = z.array(z.object({ 'Postal Code': z.string() })).parse(data);
    expect(postalCodes.length).toBeGreaterThan(0);
  });
});
