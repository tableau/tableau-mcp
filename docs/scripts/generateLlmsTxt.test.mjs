import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkLlmsTxt } from './checkLlmsTxt.mjs';
import { FULL_BASENAME, generateLlmsTxt, INDEX_BASENAME } from './generateLlmsTxt.mjs';
import { generateSiteData } from './generateSiteData.mjs';
import { generateToolCatalog } from './generateToolCatalog.mjs';
import { familyIdForRel } from './lib/llmsPages.mjs';

const realDocs = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('familyIdForRel', () => {
  it('keeps Web Tools in one family and splits Desktop Tools into three', () => {
    assert.equal(
      familyIdForRel('web-tools/pulse/list-all-pulse-metric-definitions.md'),
      'web-tools',
    );
    assert.equal(
      familyIdForRel('desktop-tools/workbook/list-worksheets.md'),
      'desktop-tools-sheets',
    );
    assert.equal(
      familyIdForRel('desktop-tools/dashboard/add-dashboard.md'),
      'desktop-tools-sheets',
    );
    assert.equal(
      familyIdForRel('desktop-tools/data-source/apply-datasource.md'),
      'desktop-tools-data',
    );
    assert.equal(familyIdForRel('desktop-tools/fields/add-field.md'), 'desktop-tools-data');
    assert.equal(
      familyIdForRel('desktop-tools/search/search-workbook-examples.md'),
      'desktop-tools-session',
    );
    assert.equal(familyIdForRel('desktop-tools/session/pin-session.md'), 'desktop-tools-session');
  });

  it('groups small site sections into overview and developers', () => {
    assert.equal(familyIdForRel('intro.md'), 'overview');
    assert.equal(familyIdForRel('privacy.md'), 'overview');
    assert.equal(familyIdForRel('release-notes.mdx'), 'overview');
    assert.equal(familyIdForRel('getting-started/README.md'), 'overview');
    assert.equal(familyIdForRel('prompts/stale-content-cleanup-inform.md'), 'overview');
    assert.equal(familyIdForRel('configuration/tableau-config.md'), 'configuration');
    assert.equal(familyIdForRel('developers/contributing.md'), 'developers');
    assert.equal(familyIdForRel('enterprise/README.md'), 'developers');
  });
});

describe('generateLlmsTxt fixture tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'llms-txt-'));
  const docsDir = join(root, 'docs-pkg');
  const pages = join(docsDir, 'docs');
  const staticDir = join(docsDir, 'static');
  const dataDir = join(docsDir, 'src/data');
  after(() => rmSync(root, { recursive: true, force: true }));

  mkdirSync(join(pages, 'guides', 'images'), { recursive: true });
  writeFileSync(join(pages, 'guides', 'images', 'diagram.png'), '');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(pages, 'intro.md'),
    '---\nsidebar_position: 1\n---\n\n# Introduction\n\nWelcome to the fixture site. More text.\n',
  );
  writeFileSync(
    join(pages, 'guides/_category_.json'),
    JSON.stringify({ label: 'Guides', position: 2, link: { description: 'How-to pages.' } }),
  );
  writeFileSync(
    join(pages, 'guides/README.md'),
    '---\nsidebar_position: 0\n---\n\n# Guides\n\nIndex of how-to pages.\n',
  );
  writeFileSync(
    join(pages, 'guides/hello.md'),
    '---\nsidebar_position: 1\n---\n\n# Hello Tool\n\nSays hello to %product_name%.\n',
  );
  writeFileSync(
    join(pages, 'guides/hello_abdd5aa26851.md'),
    '# Hello Tool - abdd5aa26851\n\nPin archive, must not publish.\n',
  );
  writeFileSync(join(dataDir, 'releaseNotes.json'), '[]\n');
  writeFileSync(join(dataDir, 'releaseSiteContent.json'), '[]\n');

  const result = generateLlmsTxt({ docsDir, staticDir });

  it('skips pin archives and uses folder URLs for README.md', () => {
    const index = readFileSync(join(docsDir, 'llms', INDEX_BASENAME), 'utf8');
    assert.match(index, /# Tableau MCP/);
    assert.match(index, /llms-full\.txt/);
    assert.doesNotMatch(index, /## Families/);
    assert.match(
      index,
      /\[Introduction\]\(https:\/\/tableau\.github\.io\/tableau-mcp\/docs\/intro\)/,
    );
    assert.match(index, /\[Guides\]\(https:\/\/tableau\.github\.io\/tableau-mcp\/docs\/guides\)/);
    assert.match(
      index,
      /\[Hello Tool\]\(https:\/\/tableau\.github\.io\/tableau-mcp\/docs\/guides\/hello\)/,
    );
    assert.doesNotMatch(index, /abdd5aa26851/);
    assert.doesNotMatch(index, /### Images/);
    assert.equal(result.pageCount, 3);
  });

  it('writes one contract llms-full.txt', () => {
    const full = readFileSync(join(docsDir, 'llms', FULL_BASENAME), 'utf8');
    assert.match(full, /Tableau MCP/);
    assert.match(full, /Tableau Studio/);
    assert.doesNotMatch(full, /%product_name%/);
    assert.equal([...full.matchAll(/^# Introduction$/gm)].length, 1);
    assert.ok(!existsSync(join(docsDir, 'llms/tableau-mcp-llms.txt')));
    const names = readdirSync(join(docsDir, 'llms')).sort();
    assert.deepEqual(names, [FULL_BASENAME, INDEX_BASENAME].sort());
  });

  it('mirrors the index to static/llms.txt for Docusaurus to serve', () => {
    const canonical = readFileSync(join(docsDir, 'llms', INDEX_BASENAME), 'utf8');
    const full = readFileSync(join(docsDir, 'llms', FULL_BASENAME), 'utf8');
    assert.equal(readFileSync(join(staticDir, 'llms.txt'), 'utf8'), canonical);
    assert.equal(readFileSync(join(staticDir, 'llms', INDEX_BASENAME), 'utf8'), canonical);
    assert.equal(readFileSync(join(staticDir, 'llms', FULL_BASENAME), 'utf8'), full);
    assert.ok(!existsSync(join(staticDir, 'tableau-mcp-llms.txt')));
  });
});

describe('generateSiteData against the real docs tree', () => {
  const { catalog, llms } = generateSiteData({ docsDir: realDocs });

  it('keeps the tool catalog in lockstep with published tool pages', () => {
    assert.equal(catalog.count, 141);
    assert.ok(catalog.entries.every((e) => e.title && e.docPath.startsWith('/docs/')));
  });

  it('indexes every published page once', () => {
    assert.ok(llms.pageCount >= 179, `expected >= 179 pages, got ${llms.pageCount}`);
    assert.ok(
      llms.llmsFullBytes < 1_000_000,
      `expected llms-full.txt under 1 MB, got ${llms.llmsFullBytes}`,
    );
    const checked = checkLlmsTxt({ docsDir: realDocs });
    assert.deepEqual(checked.errors, []);
    assert.equal(checked.ok, true);
  });

  it('generateToolCatalog remains independently callable', () => {
    const again = generateToolCatalog({ docsDir: realDocs });
    assert.equal(again.count, catalog.count);
  });
});
