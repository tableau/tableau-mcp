import z from 'zod';

import { dataSourceSchema } from '../../src/sdks/tableau/types/dataSource.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../testEnv.js';
import { callTool } from './client.js';

describe('list-datasources', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list datasources', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const datasources = await callTool('list-datasources', {
      env,
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

    const datasources = await callTool('list-datasources', {
      env,
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
