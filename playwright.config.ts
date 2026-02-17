import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'fs';

if (existsSync('.env')) {
  throw new Error(
    'Please remove or rename the .env file at the base of the project before running the tests.',
  );
}

export default defineConfig({
  testDir: './tests/oauth/tableau-authz/',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: 'npm run start:http',
    reuseExistingServer: !process.env.CI,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      SERVER: 'https://dataplane1.tableau.sfdc-3vx9f4.svc.sfdcfc.net',
      OAUTH_ISSUER: 'https://sso.online.dev.tabint.net',
      ADVERTISE_API_SCOPES: 'true',
    },
  },
});
