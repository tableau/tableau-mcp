import z from 'zod';

import { dataSourceSchema } from '../../src/sdks/tableau/types/dataSource.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../testEnv.js';
import { McpClient } from './mcpClient.js';

describe('list-datasources', () => {
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

  it('should list datasources', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const datasources = await client.callTool('list-datasources', {
      schema: z.array(dataSourceSchema),
    });

    expect(datasources.length).greaterThan(0);
    const datasource = datasources.find(
      (datasource) => datasource.name === 'Superstore Datasource',
    );

    expect(datasource).toMatchObject({
      id: superstore.id,
      name: 'Superstore Datasource',
    });
  });

  it('should list datasources with filter', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const datasources = await client.callTool('list-datasources', {
      schema: z.array(dataSourceSchema),
      toolArgs: { filter: 'name:eq:Super*' },
    });

    expect(datasources.length).greaterThan(0);
    const datasource = datasources.find(
      (datasource) => datasource.name === 'Superstore Datasource',
    );

    expect(datasource).toMatchObject({
      id: superstore.id,
      name: 'Superstore Datasource',
    });
  });
});
