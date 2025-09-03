import { MetadataOutput } from '../src/sdks/tableau/apis/vizqlDataServiceApi.js';
import invariant from '../src/utils/invariant.js';
import { deleteConfigJsons, writeConfigJson } from './configJson.js';
import { callTool } from './startInspector.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from './testEnv.js';

describe('read-metadata', () => {
  beforeAll(() => deleteConfigJsons('read-metadata'));
  afterEach(() => deleteConfigJsons('read-metadata'));

  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should read metadata', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const { filename: configJson } = writeConfigJson({
      describe: 'read-metadata',
      env,
    });

    const { data } = await callTool('read-metadata', {
      configJson,
      schema: MetadataOutput,
      toolArgs: {
        datasourceLuid: superstore.id,
      },
    });

    invariant(data, 'data is undefined');
    expect(data.length).toBeGreaterThan(0);

    const fieldNames = data.map((field) => field.fieldName);
    expect(fieldNames).toContain('Postal Code');
    expect(fieldNames).toContain('Product Name');
  });
});
