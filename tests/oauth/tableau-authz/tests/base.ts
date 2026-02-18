import { expect, test as base } from '@playwright/test';

import { getEnvFixture } from '../fixtures/env';
import { Env } from '../testEnv';

type TestFixtures = {
  env: Env;
};

export const test = base.extend<TestFixtures>({
  env: [getEnvFixture, { auto: true }],
});

export { expect };
