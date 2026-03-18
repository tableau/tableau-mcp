import { Browser, Page, WorkerFixture } from '@playwright/test';

import { ConsentFlow } from '../flows/consentFlow';
import { LoginFlow } from '../flows/loginFlow';
import { GetAuthZCodeFn, getOAuthClient, OAuthClient } from '../oauthClient';
import { Env, getEnv } from '../testEnv';

/**
 * This is a worker fixture that provides an authenticated MCP OAuth client to each test.
 * Before all tests run, it will create an MCP client and authenticate using the OAuth flow.
 * After all tests run, it will clean up by resetting the consent and revoking the token.
 * https://playwright.dev/docs/test-fixtures
 */
export const getOAuthClientFixture: WorkerFixture<OAuthClient, { browser: Browser }> = async (
  { browser },
  use,
): Promise<void> => {
  const env = getEnv();
  const client = getOAuthClient();

  const page = await browser.newPage();
  await connectOAuthClient({ client, page, env });

  await page.close();

  await use(client);

  // Reset consent and revoke token to clean up after the tests complete
  await client.resetConsent();
  await client.revokeToken();
};

async function connectOAuthClient({
  client,
  page,
  env,
}: {
  client: OAuthClient;
  page: Page;
  env: Env;
}): Promise<void> {
  const getAuthZCodeFn: GetAuthZCodeFn = async ({ authorizationUrl, callbackUrl }) => {
    await page.goto(authorizationUrl);

    const loginFlow = new LoginFlow(page);
    const consentFlow = new ConsentFlow(page);

    const codeCallbackPromise = page.waitForRequest(`${callbackUrl}*`);

    await loginFlow.fill({
      username: env.TEST_USER,
      password: env.TEST_PASSWORD,
      siteName: env.TEST_SITE_NAME,
    });

    await consentFlow.grantConsentIfNecessary();

    const request = await codeCallbackPromise;
    const url = new URL(request.url());
    const code = url.searchParams.get('code') ?? '';

    return code;
  };

  await client.attemptConnection(getAuthZCodeFn);
}
