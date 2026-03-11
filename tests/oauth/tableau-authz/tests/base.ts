import { expect, Page, test as base } from '@playwright/test';

import { getEnvFixture } from '../fixtures/env';
import { ConsentFlow } from '../flows/consentFlow';
import { LoginFlow } from '../flows/loginFlow';
import { GetAuthZCodeFn, OAuthClient } from '../oauthClient';
import { Env } from '../testEnv';

type TestFixtures = {
  env: Env;
};

export const test = base.extend<TestFixtures>({
  env: [getEnvFixture, { auto: true }],
});

export async function connectOAuthClient({
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

    await page.close();

    return code;
  };

  await client.attemptConnection(getAuthZCodeFn);
}

export { expect };
