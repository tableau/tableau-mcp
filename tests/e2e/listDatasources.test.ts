import dotenv from 'dotenv';
import z from 'zod';

import { dataSourceSchema } from '../../src/sdks/tableau/types/dataSource.js';
import { getSuperstoreDatasource } from '../testEnv.js';
import { callTool } from './client.js';

describe('list-datasources', () => {
  beforeAll(() => {
    dotenv.config();
  });

  it('should list datasources', async () => {
    const superstore = getSuperstoreDatasource();

    const datasources = await callTool('list-datasources', {
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
    const superstore = getSuperstoreDatasource();

    const datasources = await callTool('list-datasources', {
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
