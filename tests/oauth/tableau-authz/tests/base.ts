import { expect, Page, test as base } from '@playwright/test';

import { getEnvFixture } from '../fixtures/env';
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
}

export { expect };
