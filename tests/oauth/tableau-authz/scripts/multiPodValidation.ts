import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { copyFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

import { DEFAULT_MCP_SERVER_URL } from '../constants';
import { SiteName, siteNames, siteToMcpServerMap } from './siteInfo';

dotenv.config();

type SiteResult = {
  site: SiteName;
  passed: boolean;
};

function runTestsForSite(site: SiteName): SiteResult {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Running tests for site: ${site}`);
  console.log('='.repeat(60));

  const result = spawnSync(
    'npx',
    ['playwright', 'test', 'tests/oauth/tableau-authz/tests/oauth.test.ts', '--reporter=blob'],
    {
      stdio: 'inherit',
      shell: true,
      env: {
        ...process.env,
        TEST_SITE_NAME: site,
        FILL_SITE_NAME: 'true',
        MCP_SERVER_URL:
          process.env.MCP_SERVER_URL === 'pod-specific'
            ? siteToMcpServerMap[site]
            : process.env.MCP_SERVER_URL || DEFAULT_MCP_SERVER_URL,
        PLAYWRIGHT_BLOB_OUTPUT_DIR: `blob-reports/${site}`,
      },
    },
  );

  const passed = result.status === 0;
  return { site, passed };
}

function printSummary(results: SiteResult[]): void {
  console.log(`\n${'='.repeat(60)}`);
  console.log('MULTI-POD VALIDATION SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter((r) => r.passed);
  const failed = results.filter((r) => !r.passed);

  for (const result of results) {
    const status = result.passed ? '✓ PASSED' : '✗ FAILED';
    console.log(`  ${status}  ${result.site}`);
  }

  console.log(`\nResults: ${passed.length}/${results.length} sites passed`);

  if (failed.length > 0) {
    console.log('\nFailed sites:');
    for (const result of failed) {
      console.log(`  - ${result.site}`);
    }
  }
}

console.log('Clearing blob-reports directory...');
rmSync('blob-reports', { recursive: true, force: true });

const results: SiteResult[] = [];

for (const site of siteNames) {
  results.push(runTestsForSite(site));
}

printSummary(results);

console.log('\nFlattening blob report subdirectories...');
const blobReportsDir = 'blob-reports';
for (const entry of readdirSync(blobReportsDir)) {
  const subdir = join(blobReportsDir, entry);
  if (statSync(subdir).isDirectory()) {
    for (const file of readdirSync(subdir)) {
      copyFileSync(join(subdir, file), join(blobReportsDir, `${entry}-${file}`));
    }
  }
}

console.log('\nMerging blob reports...');
spawnSync('npx', ['playwright', 'merge-reports', '--reporter=html', 'blob-reports'], {
  stdio: 'inherit',
  shell: true,
});

process.exit(results.some((r) => !r.passed) ? 1 : 0);
