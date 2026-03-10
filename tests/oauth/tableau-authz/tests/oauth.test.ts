import { toolNames } from '../../../../src/tools/toolName';
import { getOAuthClient } from '../oauthClient';
import { connectOAuthClient, expect, test } from './base';

test.describe('oauth', () => {
  const client = getOAuthClient();

  test.afterEach(async () => {
    await client.close();
  });

  test.afterAll(async () => {
    await client.resetConsent();
    await client.revokeToken();
  });

  test('list tools', async ({ page, env }) => {
    await connectOAuthClient({ client, page, env });

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([...toolNames]));
    expect(names).toHaveLength(toolNames.length);
  });
});
