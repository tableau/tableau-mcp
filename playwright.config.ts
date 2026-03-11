import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import { z } from 'zod';
import { fromError } from 'zod-validation-error/v3';

dotenv.config();

const envSchema = z.object({
  SERVER: z.string(),
  OAUTH_ISSUER: z.string(),
  ADVERTISE_API_SCOPES: z
    .enum(['true', 'false'])
    .transform((value) => (value === 'true').toString()),
  OAUTH_EMBEDDED_AUTHZ_SERVER: z.literal('false'),
});

const envParseResult = envSchema.safeParse(process.env);
if (!envParseResult.success) {
  throw new Error(
    fromError(envParseResult.error, { prefix: 'Invalid environment variables' }).toString(),
  );
}

const env = envParseResult.data;

export default defineConfig({
  testDir: './tests/oauth/tableau-authz/',
  testMatch: '**/*.test.ts',
  timeout: 90_000,
  expect: {
    // Timeout for each expect()
    // https://playwright.dev/docs/api/class-testconfig#test-config-expect
    timeout: 10_000,
  },
  /* Maximum time the whole test suite can run before timing out. Only enabled in CI */
  globalTimeout: process.env.CI ? 60 * 60 * 1000 : undefined,
  /* Run tests in files sequentially */
  fullyParallel: false,
  workers: 1,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: '',
    testIdAttribute: 'data-tb-test-id',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'npm run start:http',
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env,
    },
  ],
});
