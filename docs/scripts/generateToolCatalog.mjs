// Build-time generator for docs/src/data/toolCatalog.json.
//
// Derives a filterable tool catalog as a *pure projection* of the published tool
// doc pages under docs/docs/web-tools/** and docs/docs/desktop-tools/**.
// The output is a gitignored build artifact (regenerated on every build/start/
// typecheck via the pre* npm hooks), so there is no hand-maintained data and no
// drift to review. releaseNotes.json remains the separate, curated changelog.
//
// Markdown cleaning lives in scripts/lib/docsMarkdown.mjs so llms.txt uses the
// same first-sentence / variable / availability rules. This file keeps the
// catalog-specific walk (tool roots only, overview.md skipped).
//
// This mirrors the field-derivation logic in the workshop's
// update-release-notes skill scripts, but lives in public docs/ so it runs on
// the public mirror with no extra shipped data.
//
// Dependency-free ESM. Node >= 18.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  categoryInfo,
  derivePageProse,
  PAGE_ROOTS,
  SKIP_BASENAMES,
  TOOL_TYPE_ORDER,
  toolTypeForRel,
} from './lib/docsMarkdown.mjs';
import { NONPUBLISH_RE } from './lib/nonpublishable.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DOCS_DIR = join(SCRIPT_DIR, '..');

function listToolPages(docsRoot) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(p);
      } else if (
        ent.name.endsWith('.md') &&
        !SKIP_BASENAMES.has(ent.name) &&
        !NONPUBLISH_RE.test(ent.name)
      ) {
        out.push(p);
      }
    }
  };
  for (const r of PAGE_ROOTS) walk(join(docsRoot, r));
  return out.sort();
}

function deriveEntry(pageAbs, docsRoot) {
  const rel = relative(docsRoot, pageAbs).replace(/\\/g, '/');
  const toolName = basename(pageAbs).replace(/\.md$/, '');
  const docPath = '/docs/' + rel.replace(/\.md$/, '');
  const { title, summary } = derivePageProse(pageAbs);
  const { label: toolCategory, description: toolCategoryDescription } = categoryInfo(pageAbs);
  return {
    toolName,
    title,
    summary,
    toolType: toolTypeForRel(rel),
    toolCategory,
    toolCategoryDescription,
    docPath,
  };
}

const toolTypeRank = (t) => {
  const idx = TOOL_TYPE_ORDER.indexOf(t);
  return idx === -1 ? TOOL_TYPE_ORDER.length : idx;
};

export function generateToolCatalog({ docsDir = DEFAULT_DOCS_DIR } = {}) {
  const docsRoot = join(docsDir, 'docs');
  const dataFile = join(docsDir, 'src/data/toolCatalog.json');
  const entries = listToolPages(docsRoot).map((p) => deriveEntry(p, docsRoot));
  entries.sort(
    (a, b) =>
      toolTypeRank(a.toolType) - toolTypeRank(b.toolType) ||
      String(a.toolType).localeCompare(String(b.toolType)) ||
      a.toolCategory.localeCompare(b.toolCategory) ||
      a.title.localeCompare(b.title),
  );
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, JSON.stringify(entries, null, 2) + '\n');
  return { count: entries.length, path: dataFile, entries };
}

function isMain() {
  return Boolean(process.argv[1] && process.argv[1].endsWith('generateToolCatalog.mjs'));
}

if (isMain()) {
  const result = generateToolCatalog();
  console.log(
    `generateToolCatalog: wrote ${result.count} tools to ${relative(DEFAULT_DOCS_DIR, result.path)}`,
  );
}
