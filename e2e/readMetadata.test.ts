import { MetadataOutput } from '../src/sdks/tableau/apis/vizqlDataServiceApi.js';
import invariant from '../src/utils/invariant.js';
import { callTool } from './client.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from './testEnv.js';

describe('read-metadata', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should read metadata', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const { data } = await callTool('read-metadata', {
      env,
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
