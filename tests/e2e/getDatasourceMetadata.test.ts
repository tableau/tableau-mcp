import { fieldsResultSchema } from '../../src/tools/web/getDatasourceMetadata/datasourceMetadataUtils.js';
import invariant from '../../src/utils/invariant.js';
import { getDefaultEnv, getSuperstoreDatasource, resetEnv, setEnv } from '../testEnv.js';
import { McpClient } from './mcpClient.js';

describe('get-datasource-metadata', () => {
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

  it('should get metadata', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const { fieldGroups } = await client.callTool('get-datasource-metadata', {
      schema: fieldsResultSchema,
      toolArgs: {
        datasourceLuid: superstore.id,
      },
    });

    invariant(fieldGroups, 'fieldGroups is undefined');
    const flatFields = fieldGroups.flatMap((group) => group.fields ?? []);
    expect(flatFields.length).toBeGreaterThan(0);

    const fieldNames = flatFields.map((field) => field.name);
    expect(fieldNames).toContain('Postal Code');
    expect(fieldNames).toContain('Product Name');

    const stringFieldsWithSamples = flatFields.filter(
      (field) =>
        field.dataType === 'STRING' &&
        Array.isArray(field.sampleValues) &&
        field.sampleValues.length > 0,
    );
    expect(stringFieldsWithSamples.length).toBeGreaterThan(0);
    for (const field of stringFieldsWithSamples) {
      expect(field.sampleValues!.length).toBeLessThanOrEqual(3);
      for (const value of field.sampleValues!) {
        expect(typeof value).toBe('string');
      }
    }
  });

  it('should omit sampleValues when sampleStringValues is false', async () => {
    const env = getDefaultEnv();
    const superstore = getSuperstoreDatasource(env);

    const { fieldGroups } = await client.callTool('get-datasource-metadata', {
      schema: fieldsResultSchema,
      toolArgs: {
        datasourceLuid: superstore.id,
        sampleStringValues: false,
      },
    });

    invariant(fieldGroups, 'fieldGroups is undefined');
    const flatFields = fieldGroups.flatMap((group) => group.fields ?? []);
    expect(flatFields.length).toBeGreaterThan(0);

    for (const field of flatFields) {
      expect(field.sampleValues).toBeUndefined();
    }
  });
});
