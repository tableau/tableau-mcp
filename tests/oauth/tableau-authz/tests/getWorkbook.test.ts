import { workbookSchema } from '../../../../src/sdks/tableau/types/workbook';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';
import { getSuperstoreWorkbook } from './testEnv';

test.describe('get-workbook', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('get workbook', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const superstore = getSuperstoreWorkbook();

    const workbook = await client.callTool('get-workbook', {
      schema: workbookSchema,
      toolArgs: {
        workbookId: superstore.id,
      },
    });

    expect(workbook).toMatchObject(superstore);
  });
});
