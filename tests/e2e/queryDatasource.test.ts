import z from 'zod';

import { queryOutputSchema } from '../../src/sdks/tableau/apis/vizqlDataServiceApi.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../testEnv.js';
import { McpClient } from './mcpClient.js';

describe('query-datasource', () => {
  let client: McpClient;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient();
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('should query datasource', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

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
