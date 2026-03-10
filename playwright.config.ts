import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'fs';

if (existsSync('.env')) {
  throw new Error(
    'Please remove or rename the .env file at the base of the project before running the tests.',
  );
}

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
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  workers: 1,
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

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  webServer: [
    {
      command: 'npm run start:http',
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        SERVER: 'https://test-dataplane7.tableau.sfdc-ckzqgc.svc.sfdcfc.net',
        OAUTH_ISSUER: 'https://sso.online.vnext.tabint.net',
        ADVERTISE_API_SCOPES: 'true',
        OAUTH_EMBEDDED_AUTHZ_SERVER: 'false',
      },
    },
  ],
});
