import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import z from 'zod';

import { dataSourceSchema } from '../src/sdks/tableau/types/dataSource.js';
import invariant from '../src/utils/invariant.js';
import { deleteConfigJsons, writeConfigJson } from './configJson.js';
import { getDatasource } from './constants.js';
import { startInspector } from './startInspector.js';
import { getEnv, resetEnv, setEnv } from './testEnv.js';

describe('list-datasources', () => {
  beforeAll(() => deleteConfigJsons('list-datasources'));
  afterEach(() => deleteConfigJsons('list-datasources'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list datasources', async () => {
    const env = getEnv([
      'SERVER',
      'SITE_NAME',
      'AUTH',
      'JWT_SUB_CLAIM',
      'CONNECTED_APP_CLIENT_ID',
      'CONNECTED_APP_SECRET_ID',
      'CONNECTED_APP_SECRET_VALUE',
    ]);

    const { SERVER, SITE_NAME } = env;
    const superstore = getDatasource(SERVER, SITE_NAME, 'Superstore Datasource');

    const { filename: configJson } = writeConfigJson({
      describe: 'list-datasources',
      env,
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
          id: superstore.id,
          name: 'Superstore Datasource',
          project: expect.any(Object),
        },
      ]),
    );
  });

  it('should list datasources with filter', async () => {
    const env = getEnv([
      'SERVER',
      'SITE_NAME',
      'AUTH',
      'JWT_SUB_CLAIM',
      'CONNECTED_APP_CLIENT_ID',
      'CONNECTED_APP_SECRET_ID',
      'CONNECTED_APP_SECRET_VALUE',
    ]);

    const { SERVER, SITE_NAME } = env;
    const superstore = getDatasource(SERVER, SITE_NAME, 'Superstore Datasource');

    const { filename: configJson } = writeConfigJson({
      describe: 'list-datasources',
      env,
    });

    const result = await startInspector(
      {
        '--config': configJson,
        '--server': 'tableau',
        '--method': 'tools/call',
        '--tool-name': 'list-datasources',
        '--tool-args': { filter: 'name:eq:Super*' },
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
          id: superstore.id,
          name: 'Superstore Datasource',
          project: expect.any(Object),
        },
      ]),
    );
  });
});
