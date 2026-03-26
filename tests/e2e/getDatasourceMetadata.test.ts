import dotenv from 'dotenv';

import { fieldsResultSchema } from '../../src/tools/getDatasourceMetadata/datasourceMetadataUtils.js';
import invariant from '../../src/utils/invariant.js';
import { getSuperstoreDatasource } from '../testEnv.js';
import { callTool } from './client.js';

describe('get-datasource-metadata', () => {
  beforeAll(() => {
    dotenv.config();
  });

  it('should get metadata', async () => {
    const superstore = getSuperstoreDatasource();

    const { fieldGroups } = await callTool('get-datasource-metadata', {
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
  });
});
