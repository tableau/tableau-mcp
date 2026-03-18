import { z } from 'zod';

import { dataSourceSchema } from '../../../../src/sdks/tableau/types/dataSource.js';
import { expect, test } from './base.js';

// Skip until Content Exploration issues are resolved
test.describe.skip('list-datasources', () => {
  test('list datasources', async ({ client }) => {
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
