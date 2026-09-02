import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_DOCS_ROOT,
  findRemovedToolNameReferences,
  REMOVED_TOOL_NAMES,
} from './check-removed-tool-names.mjs';

const SCRIPT = fileURLToPath(new URL('./check-removed-tool-names.mjs', import.meta.url));

/** Create a temp docs tree from a { relativePath: contents } map. */
function makeDocsTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'docs-guard-'));
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

function withDocsTree(files, fn) {
  const root = makeDocsTree(files);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Run the guard CLI against `rootDir`; returns the spawn result. */
function runGuardCli(rootDir) {
  return spawnSync(process.execPath, [SCRIPT, rootDir], { encoding: 'utf8' });
}

test('deny-list is non-empty and includes the seed name', () => {
  assert.ok(REMOVED_TOOL_NAMES.length > 0);
  assert.ok(REMOVED_TOOL_NAMES.includes('get-stale-content-report'));
});

test('passes when no removed tool names are present', () => {
  withDocsTree(
    {
      'intro.md': 'Use the `query-admin-insights` tool with `kind: "stale-content"`.',
      'nested/config.md': 'See query-datasource and get-datasource-metadata.',
    },
    (root) => {
      const { violations, filesScanned } = findRemovedToolNameReferences(root);
      assert.equal(violations.length, 0);
      assert.equal(filesScanned, 2);
    },
  );
});

test('flags a removed tool name in prose and backticks, with accurate line numbers (.md and .mdx)', () => {
  withDocsTree(
    {
      // Removed name on line 3 (not line 1) so the reported line number is actually exercised.
      'intro.md': '# Intro\n\nCall the `get-stale-content-report` tool to find stale content.',
      'guide/usage.mdx': 'The get-stale-content-report output lists workbooks.',
    },
    (root) => {
      const { violations } = findRemovedToolNameReferences(root);
      assert.equal(violations.length, 2);
      assert.ok(violations.every((v) => v.name === 'get-stale-content-report'));
      const intro = violations.find((v) => v.file.endsWith('intro.md'));
      const usage = violations.find((v) => v.file.endsWith('usage.mdx'));
      assert.equal(intro.line, 3);
      assert.equal(usage.line, 1);
    },
  );
});

test('does not false-positive on kind values or longer identifiers', () => {
  withDocsTree(
    {
      'kinds.md': [
        '- `stale-content`',
        '- `ts-events`',
        '- `ts-users`',
        '- `site-content`',
        '- `job-performance`',
        'A hypothetical `get-stale-content-report-v2` token must not match.',
      ].join('\n'),
    },
    (root) => {
      const { violations } = findRemovedToolNameReferences(root);
      assert.equal(violations.length, 0);
    },
  );
});

test('skips node_modules and dot-directories', () => {
  withDocsTree(
    {
      'intro.md': 'Clean doc referencing `query-admin-insights`.',
      'node_modules/pkg/README.md': 'Third-party `get-stale-content-report` mention.',
      '.cache/leftover.md': 'Stale `get-stale-content-report` build artifact.',
    },
    (root) => {
      const { violations, filesScanned } = findRemovedToolNameReferences(root);
      assert.equal(filesScanned, 1);
      assert.equal(violations.length, 0);
    },
  );
});

test('default docs root resolves to the real docs and scans files (wiring)', () => {
  const { filesScanned } = findRemovedToolNameReferences(DEFAULT_DOCS_ROOT);
  assert.ok(filesScanned > 0, 'expected DEFAULT_DOCS_ROOT to resolve to a non-empty docs tree');
});

test('CLI exits 0 on the real docs tree (default root)', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('CLI exits 1 when a removed tool name is present', () => {
  withDocsTree({ 'intro.md': 'Use the `get-stale-content-report` tool.' }, (root) => {
    const result = runGuardCli(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /get-stale-content-report/);
  });
});

test('CLI exits 1 when it scans zero doc files (never passes vacuously)', () => {
  withDocsTree({}, (root) => {
    const result = runGuardCli(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /0 doc files/);
  });
});
