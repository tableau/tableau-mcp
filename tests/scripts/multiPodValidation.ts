import { spawnSync } from 'child_process';
import { copyFileSync, readdirSync, rmSync, statSync } from 'fs';
import { join } from 'path';

// Test Sites canvas:
// https://salesforce.enterprise.slack.com/docs/T5J4Q04QG/F0B7Q4Z2QLX
const SITES = [
  'mcp-uwc-test',
  //'mcp-uw2a-test',
  'mcp-uw2b-test',
  'mcp-10ax-test',
  'mcp-10ay-test',
  //'mcp-10az-test',
  'mcp-caa-test',
  'mcp-uea-test',
  'mcp-ueb-test',
  'mcp-uec-test',
  'mcp-ue1-test',
  'mcp-dub01-test',
  'mcp-ew1a-test',
  'mcp-uka-test',
  // 'mcp-cha-test',
  // 'mcp-apsea-test',
  // 'mcp-apseb-test',
  // 'mcp-apsec-test',
  // 'mcp-apnea-test',
  // 'mcp-kra-test',
  // 'mcp-ina-test',
];

type SiteResult = {
  site: string;
  passed: boolean;
};

function runTestsForSite(site: string): SiteResult {
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

for (const site of SITES) {
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
