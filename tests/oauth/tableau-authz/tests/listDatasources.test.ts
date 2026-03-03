import z from 'zod';

import { dataSourceSchema } from '../../../../src/sdks/tableau/types/dataSource';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';

test.describe('listDatasources', () => {
  test('list datasources', async ({ page, env }) => {
    const client = getOAuthClient();
    await connectOAuthClient({ client, page, env });

    const datasources = await client.callTool('list-datasources', {
      schema: z.array(dataSourceSchema),
    });

    expect(datasources.length).toBeGreaterThan(0);
    const datasource = datasources.find(
      (datasource) => datasource.name === 'Superstore Datasource',
    );

    expect(datasource).toMatchObject({
      name: 'Superstore Datasource',
    });
  });
});
