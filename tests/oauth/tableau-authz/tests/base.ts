import { expect, test as base } from '@playwright/test';

import { getOAuthClientFixture } from '../fixtures/connectOAuthClient.js';
import { getEnvFixture } from '../fixtures/env.js';
import { OAuthClient } from '../oauthClient.js';
import { Env } from '../testEnv.js';

type TestFixtures = {
  env: Env;
};

type WorkerFixtures = {
  client: OAuthClient;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  env: [getEnvFixture, { auto: true }],
  client: [getOAuthClientFixture, { scope: 'worker', auto: false }],
});

export { expect };
