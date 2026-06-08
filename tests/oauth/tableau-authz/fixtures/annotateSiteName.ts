import { Browser, TestFixture } from '@playwright/test';

import { getEnv } from '../testEnv.js';

export const annotateSiteNameFixture: TestFixture<void, { browser: Browser }> = async (
  { browser: _ },
  use,
  testInfo,
): Promise<void> => {
  const { TEST_SITE_NAME } = getEnv();
  if (TEST_SITE_NAME) {
    testInfo.annotations.push({ type: 'site', description: TEST_SITE_NAME });
  }
  await use();
};
