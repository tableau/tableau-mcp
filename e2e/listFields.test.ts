import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

import { graphqlResponse } from '../src/sdks/tableau/apis/metadataApi.js';
import invariant from '../src/utils/invariant.js';
import { deleteConfigJsons, writeConfigJson } from './configJson.js';
import { startInspector } from './startInspector.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from './testEnv.js';

describe('list-fields', () => {
  beforeAll(() => deleteConfigJsons('list-fields'));
  afterEach(() => deleteConfigJsons('list-fields'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should list fields', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const { filename: configJson } = writeConfigJson({
      describe: 'list-fields',
      env,
    });

    const result = await startInspector(
      {
        '--config': configJson,
        '--server': 'tableau',
        '--method': 'tools/call',
        '--tool-name': 'list-fields',
        '--tool-args': { datasourceLuid: superstore.id },
      },
      CallToolResultSchema,
    );

    expect(result.isError).toBe(false);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const text = result.content[0].text;
    invariant(typeof text === 'string');
    const { data } = graphqlResponse.parse(JSON.parse(text));

    expect(data.publishedDatasources.length).greaterThan(0);

    const datasource = data.publishedDatasources[0];
    expect(datasource.name).toBe('Superstore Datasource');

    expect(datasource.fields.length).greaterThan(0);
    const fieldNames = datasource.fields.map((field) => field.name);
    expect(fieldNames).toContain('Postal Code');
    expect(fieldNames).toContain('Product');
  });
});
