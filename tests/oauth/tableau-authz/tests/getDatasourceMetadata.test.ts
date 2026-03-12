import { fieldsResultSchema } from '../../../../src/tools/getDatasourceMetadata/datasourceMetadataUtils';
import invariant from '../../../../src/utils/invariant';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';
import { getSuperstoreDatasource } from './testEnv';

test.describe('get-datasource-metadata', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('get datasource metadata', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

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
