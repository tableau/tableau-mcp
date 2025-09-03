import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import { globSync, unlinkSync } from 'fs';
import z from 'zod';

import { dataSourceSchema } from '../src/sdks/tableau/types/dataSource.js';
import invariant from '../src/utils/invariant.js';
import { startInspector } from './startInspector.js';
import { writeConfigJson } from './writeConfigJson.js';

describe('list-datasources', () => {
  beforeAll(deleteConfigJsons);
  afterEach(deleteConfigJsons);

  beforeAll(() => {
    dotenv.config({ path: 'e2e/.env', override: true });
  });

  function deleteConfigJsons(): void {
    const configJsons = globSync('config.list-datasources.*.test.json');
    configJsons.forEach(unlinkSync);
  }

  it('should list datasources', async () => {
    const {
      SERVER,
      SITE_NAME,
      AUTH,
      JWT_SUB_CLAIM,
      CONNECTED_APP_CLIENT_ID,
      CONNECTED_APP_SECRET_ID,
      CONNECTED_APP_SECRET_VALUE,
    } = process.env;

    const { filename: configJson } = writeConfigJson({
      describe: 'list-datasources',
      env: {
        SERVER,
        SITE_NAME,
        AUTH,
        JWT_SUB_CLAIM,
        CONNECTED_APP_CLIENT_ID,
        CONNECTED_APP_SECRET_ID,
        CONNECTED_APP_SECRET_VALUE,
      },
    });

    const result = await startInspector(
      {
        '--config': configJson,
        '--server': 'tableau',
        '--method': 'tools/call',
        '--tool-name': 'list-datasources',
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const text = result.content[0].text;
    invariant(typeof text === 'string');
    const datasources = z.array(dataSourceSchema).parse(JSON.parse(text));

    expect(datasources).toHaveLength(1);
    expect(datasources).toEqual(
      expect.arrayContaining([
        {
          id: '2d935df8-fe7e-4fd8-bb14-35eb4ba31d45',
          name: 'Superstore Datasource',
          project: { name: 'Samples', id: 'cbec32db-a4a2-4308-b5f0-4fc67322f359' },
        },
      ]),
    );

    console.log(result);
  });
});
