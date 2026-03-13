import { fieldsResultSchema } from '../../../../src/tools/getDatasourceMetadata/datasourceMetadataUtils';
import invariant from '../../../../src/utils/invariant';
import { expect, test } from './base';
import { getSuperstoreDatasource } from './testEnv';

test.describe('get-datasource-metadata', () => {
  test('get datasource metadata', async ({ client }) => {
    const superstore = getSuperstoreDatasource();

    const { fields } = await client.callTool('get-datasource-metadata', {
      schema: fieldsResultSchema,
      toolArgs: {
        datasourceLuid: superstore.id,
      },
    });

    invariant(fields, 'fields is undefined');
    expect(fields.length).toBeGreaterThan(0);

    const fieldNames = fields.map((field) => field.name);
    expect(fieldNames).toContain('Postal Code');
    expect(fieldNames).toContain('Product Name');
  });
});
