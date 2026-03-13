import z from 'zod';

import { queryOutputSchema } from '../../../../src/sdks/tableau/apis/vizqlDataServiceApi';
import { expect, test } from './base';
import { getSuperstoreDatasource } from './testEnv';

test.describe('query-datasource', () => {
  test('query datasource', async ({ client }) => {
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
