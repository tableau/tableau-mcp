import { expect, test as base } from '@playwright/test';

import { getOAuthClientFixture } from '../fixtures/connectOAuthClient';
import { getEnvFixture } from '../fixtures/env';
import { OAuthClient } from '../oauthClient';
import { Env } from '../testEnv';

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
