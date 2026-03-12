import z from 'zod';

import { workbookSchema } from '../../../../src/sdks/tableau/types/workbook';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';
import { getSuperstoreWorkbook } from './testEnv';

// Skip until Content Exploration issues are resolved
test.describe.skip('list-workbooks', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('list workbooks', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const superstore = getSuperstoreWorkbook();

    const workbooks = await client.callTool('list-workbooks', {
      schema: z.array(workbookSchema),
      toolArgs: {},
    });

    expect(workbooks.length).toBeGreaterThan(0);
    const workbook = workbooks.find((workbook) => workbook.name === 'Superstore');

    expect(workbook).toMatchObject(superstore);
  });
});
