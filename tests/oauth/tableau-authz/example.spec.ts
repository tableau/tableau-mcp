import { expect, test } from '@playwright/test';

import { toolNames } from '../../../src/tools/toolName';
import invariant from '../../../src/utils/invariant';
import { getOauthClient } from './oauthClient';

test('create mcp client', async ({ page }) => {
  const client = getOauthClient();

  await client.attemptConnection(async (authorizationUrl) => {
    await page.goto(authorizationUrl);
    await page.locator('#email').fill(process.env.TEST_USER ?? '');
    await page.locator('#login-submit').click();
    await page.locator('#site-uri').fill(process.env.TEST_SITE_NAME ?? '');
    await page.locator('#verify-button').click();
    await page.locator('#password').fill(process.env.TEST_PASSWORD ?? '');
    await page.locator('#signInButton').click();

    const request = await page.waitForRequest('https://client.dev/oauth/callback*');
    const url = new URL(request.url());
    const code = url.searchParams.get('code');
    invariant(code, 'Authz code not found in callback URL');
    return code;
  });

  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name);
  expect(names).toEqual(expect.arrayContaining([...toolNames]));
  expect(names).toHaveLength(toolNames.length);
});
