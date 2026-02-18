import { toolNames } from '../../../../src/tools/toolName';
import { TableauCloudLoginFlow } from '../flows/tableauCloudLoginFlow';
import { getOauthClient } from '../oauthClient';
import { expect, test } from './base';

test.describe('oauth', () => {
  test('list tools', async ({ page, env }) => {
    const client = getOauthClient();

    await client.attemptConnection(async ({ authorizationUrl, callbackUrl }) => {
      await page.goto(authorizationUrl);
      const flow = new TableauCloudLoginFlow(page);
      await flow.fill({
        username: env.TEST_USER,
        password: env.TEST_PASSWORD,
        siteName: env.TEST_SITE_NAME,
      });

      const request = await page.waitForRequest(`${callbackUrl}*`);
      const url = new URL(request.url());
      const code = url.searchParams.get('code') ?? '';
      return code;
    });

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining([...toolNames]));
    expect(names).toHaveLength(toolNames.length);
  });
});
