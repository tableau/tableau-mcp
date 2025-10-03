import z from 'zod';

import { QueryOutput } from '../../src/sdks/tableau/apis/vizqlDataServiceApi.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../testEnv.js';
import { callTool } from './client.js';

describe('query-datasource', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should query datasource', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const { data } = await callTool('query-datasource', {
      env,
      schema: QueryOutput,
      toolArgs: {
        datasourceLuid: superstore.id,
        query: { fields: [{ fieldCaption: 'Postal Code' }] },
      },
    });

    const postalCodes = z.array(z.object({ 'Postal Code': z.string() })).parse(data);
    expect(postalCodes.length).toBeGreaterThan(0);
  });
});
