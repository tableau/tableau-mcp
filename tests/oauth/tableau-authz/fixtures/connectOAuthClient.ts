import { Browser, expect, Page, WorkerFixture } from '@playwright/test';
import { z } from 'zod';

import { ConsentFlow } from '../flows/consentFlow.js';
import { LoginFlow } from '../flows/loginFlow.js';
import { GetAuthZCodeFn, getOAuthClient, OAuthClient } from '../oauthClient.js';
import { Env, getEnv } from '../testEnv.js';

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

  // Teardown: reset consent first (requires a valid token), then revoke.
  // Order matters: reset-consent uses the access token, so it must run before revocation.
  // Both calls go through the MCP tool path to exercise real tool coverage.
  // reset-consent is best-effort; revoking the token is asserted so failures are surfaced.
  try {
    const resetConsentResult = await client.callTool('reset-consent', {
      schema: z.string(),
      toolArgs: {},
    });
    expect(resetConsentResult).toContain('consent');
  } catch {
    // best-effort: do not prevent revocation if consent reset fails
  }

  try {
    const revokeResult = await client.callTool('revoke-access-token', {
      schema: z.string(),
      toolArgs: {},
    });
    expect(revokeResult).toContain('revocation');
  } finally {
    await client.close();
  }
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
