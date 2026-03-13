import { Browser, TestFixture } from '@playwright/test';

import { Env, getEnv } from '../testEnv';

// https://playwright.dev/docs/test-fixtures
// This is a test fixture that provides validated environment variables to tests.
export const getEnvFixture: TestFixture<Env, { browser: Browser }> = (
  { browser: _ },
  use,
): void => {
  use(getEnv());
};
