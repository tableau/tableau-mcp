import dotenv from 'dotenv';
import z from 'zod';

import { queryOutputSchema } from '../../src/sdks/tableau/apis/vizqlDataServiceApi.js';
import { getSuperstoreDatasource } from '../testEnv.js';
import { callTool } from './client.js';

describe('query-datasource', () => {
  beforeAll(() => {
    dotenv.config();
  });

  it('should query datasource', async () => {
    const superstore = getSuperstoreDatasource();

    const { data } = await callTool('query-datasource', {
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
