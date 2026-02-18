import { test } from '@playwright/test';

import invariant from '../../../src/utils/invariant';
import { OAuthClient } from './oauthClient';

test('create mcp client', async ({ page }) => {
  const client = new OAuthClient(
    'http://127.0.0.1:3927/tableau-mcp',
    'https://client.dev/oauth/metadata.json', // Masquerade as client.dev
  );

  const { getAuthorizationUrl, oauthProvider } = client.getOAuthProvider();
  await client.attemptConnection(oauthProvider, async () => {
    const authorizationUrl = await getAuthorizationUrl.promise;
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
});
