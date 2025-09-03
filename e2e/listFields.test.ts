import { graphqlResponse } from '../src/sdks/tableau/apis/metadataApi.js';
import { deleteConfigJsons, writeConfigJson } from './configJson.js';
import { callTool } from './startInspector.js';
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

    const { data } = await callTool({
      configJson,
      toolName: 'list-fields',
      schema: graphqlResponse,
      toolArgs: { datasourceLuid: superstore.id },
    });

    expect(data.publishedDatasources.length).greaterThan(0);

    const datasource = data.publishedDatasources[0];
    expect(datasource.name).toBe('Superstore Datasource');

    expect(datasource.fields.length).greaterThan(0);
    const fieldNames = datasource.fields.map((field) => field.name);
    expect(fieldNames).toContain('Postal Code');
    expect(fieldNames).toContain('Product');
  });
});
