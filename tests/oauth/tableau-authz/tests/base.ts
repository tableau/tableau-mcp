import { expect, Page, test as base } from '@playwright/test';

import { getEnvFixture } from '../fixtures/env';
import { TableauCloudConsentFlow } from '../flows/consentFlow';
import { TableauCloudLoginFlow } from '../flows/tableauCloudLoginFlow';
import { OAuthClient } from '../oauthClient';
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
  await client.attemptConnection(async ({ authorizationUrl, callbackUrl }) => {
    await page.goto(authorizationUrl);

    const flow = new TableauCloudLoginFlow(page);
    const consentFlow = new TableauCloudConsentFlow(page);

    const codeCallbackPromise = page.waitForRequest(`${callbackUrl}*`);

    await flow.fill({
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
  });
}

export { expect };
