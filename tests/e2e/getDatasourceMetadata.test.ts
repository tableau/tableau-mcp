import { fieldsResultSchema } from '../../src/tools/getDatasourceMetadata/datasourceMetadataUtils.js';
import invariant from '../../src/utils/invariant.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../testEnv.js';
import { callTool } from './client.js';

describe('get-datasource-metadata', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  it('should get metadata', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const { fields } = await callTool('get-datasource-metadata', {
      env,
      schema: fieldsResultSchema,
      toolArgs: {
        datasourceLuid: superstore.id,
      },
    });

    invariant(fields, 'data is undefined');
    const flatFields = fields.flatMap((group) => group.columns ?? []);
    expect(flatFields.length).toBeGreaterThan(0);

    const fieldNames = flatFields.map((field) => field.name);
    expect(fieldNames).toContain('Postal Code');
    expect(fieldNames).toContain('Product Name');
  });
});
