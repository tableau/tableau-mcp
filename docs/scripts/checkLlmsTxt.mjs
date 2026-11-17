// Assert the generated llms artifacts are complete and under 1 MB.
//
// Always checks docs/llms/ and the static/ copies Docusaurus will serve.
// Pass --build (CI, after `npm run build`) to also require the copies in
// build/tableau-mcp/.
//
// Dependency-free ESM. Node >= 18.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FULL_BASENAME, INDEX_BASENAME } from './generateLlmsTxt.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DOCS_DIR = join(SCRIPT_DIR, '..');

const MIN_PAGES = 170;
const MIN_CORPUS_BYTES = 500 * 1024;
const MAX_CORPUS_BYTES = 1_000_000;
const TOKEN = /%[a-zA-Z0-9_]+%/g;
const EXT_LINK = /ext:\/\//;
const LIST_ITEM = /^- \[([^\]]+)\]\((https?:[^)]+)\)/gm;
const ALLOWED = new Set([INDEX_BASENAME, FULL_BASENAME]);

export function checkLlmsTxt({ docsDir = DEFAULT_DOCS_DIR, requireBuild = false } = {}) {
  const errors = [];
  const err = (m) => errors.push(m);

  const canonicalDir = join(docsDir, 'llms');
  const indexPath = join(canonicalDir, INDEX_BASENAME);
  const fullPath = join(canonicalDir, FULL_BASENAME);
  if (!existsSync(indexPath)) err(`missing ${indexPath} — run generateSiteData.mjs`);
  if (!existsSync(fullPath)) err(`missing ${fullPath} — run generateSiteData.mjs`);
  if (errors.length) return { ok: false, errors };

  const index = readFileSync(indexPath, 'utf8');
  const full = readFileSync(fullPath, 'utf8');
  const corpusBytes = statSync(fullPath).size;

  const leftover = [...(index.match(TOKEN) || []), ...(full.match(TOKEN) || [])];
  if (EXT_LINK.test(index)) err('ext:// protocol placeholder survived into the index');
  if (EXT_LINK.test(full)) err('ext:// survived into llms-full.txt');
  if (/^## Related\s*$/m.test(full)) err('llms-full.txt still contains a ## Related section');
  if (/^## Example results?\s*$/m.test(full)) err('llms-full.txt still contains an example-results section');
  if (leftover.length) err(`leftover %variable% text: ${[...new Set(leftover)].join(', ')}`);
  if (corpusBytes < MIN_CORPUS_BYTES) {
    err(`llms-full.txt is ${corpusBytes} bytes; expected at least ${MIN_CORPUS_BYTES}`);
  }
  if (corpusBytes > MAX_CORPUS_BYTES) {
    err(`llms-full.txt is ${corpusBytes} bytes; must stay under ${MAX_CORPUS_BYTES}`);
  }
  if (!index.includes(FULL_BASENAME)) err('llms.txt does not point at llms-full.txt');

  const unexpected = readdirSync(canonicalDir).filter((n) => !ALLOWED.has(n));
  if (unexpected.length) err(`leftover files in llms/: ${unexpected.join(', ')}`);

  const items = [...index.matchAll(LIST_ITEM)];
  if (items.length < MIN_PAGES) {
    err(`llms index lists ${items.length} links; expected at least ${MIN_PAGES}`);
  }

  const staticIndex = join(docsDir, 'static', INDEX_BASENAME);
  const staticFolderIndex = join(docsDir, 'static/llms', INDEX_BASENAME);
  const staticFolderFull = join(docsDir, 'static/llms', FULL_BASENAME);
  for (const p of [staticIndex, staticFolderIndex]) {
    if (!existsSync(p)) err(`missing served copy ${p}`);
    else if (readFileSync(p, 'utf8') !== index) err(`${p} does not match canonical index`);
  }
  if (!existsSync(staticFolderFull)) err(`missing served copy ${staticFolderFull}`);
  else if (readFileSync(staticFolderFull, 'utf8') !== full) err(`${staticFolderFull} does not match canonical`);
  if (existsSync(join(docsDir, 'static/tableau-mcp-llms.txt'))) {
    err('leftover docs/static/tableau-mcp-llms.txt');
  }

  const buildDir = join(docsDir, 'build/tableau-mcp');
  const builtIndex = join(buildDir, INDEX_BASENAME);
  if (requireBuild) {
    if (!existsSync(builtIndex)) err(`build is missing ${builtIndex}`);
    else if (readFileSync(builtIndex, 'utf8') !== index) err('build/llms.txt does not match canonical');
    const builtFull = join(buildDir, 'llms', FULL_BASENAME);
    if (!existsSync(builtFull)) err(`build is missing ${builtFull}`);
  }

  return {
    ok: errors.length === 0,
    errors,
    pageCount: items.length,
    corpusBytes,
  };
}

function isMain() {
  return Boolean(process.argv[1] && process.argv[1].endsWith('checkLlmsTxt.mjs'));
}

if (isMain()) {
  const requireBuild = process.argv.includes('--build') || process.env.CHECK_LLMS_BUILD === '1';
  const result = checkLlmsTxt({ requireBuild });
  if (!result.ok) {
    for (const e of result.errors) console.error(`ERROR ${e}`);
    process.exit(1);
  }
  console.log(
    `OK: ${INDEX_BASENAME} lists ${result.pageCount} links; ${FULL_BASENAME} is ${result.corpusBytes} bytes`,
  );
}
