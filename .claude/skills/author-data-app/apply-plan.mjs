#!/usr/bin/env node
/**
 * Deterministically finalize a scaffolded data app workspace by applying the
 * `postUnzip` plan returned by the `scaffold-data-app` MCP tool.
 *
 * The remote (http) transport returns a plan of the shape:
 *   { instructions, edits: [{ file, replacements: [{ find, replace, occurrence }] }],
 *     renames: [{ from, to }], wiresDatasource }
 * where every `file`/`from`/`to` path is relative to the unzip directory and
 * includes the template root dir prefix (e.g. "Data App Name/...").
 *
 * Order matters and is the whole reason this is a script rather than freehand
 * edits: apply EVERY edit first (literal, non-regex find/replace on file
 * contents), THEN apply the renames in the given order (deepest paths first,
 * the root dir last). Doing renames before edits would invalidate the edit
 * paths; reordering renames would rename a parent out from under a child.
 *
 * Each replacement's `occurrence` is `'first'` (replace only the first
 * remaining occurrence — used to resolve two textually-identical anchors to
 * two different values in sequence) or `'all'`/omitted (replace every
 * occurrence, the default). When `wiresDatasource` is truthy, the plan's
 * `.twb` edit included datasource-wiring replacements, so the residual-token
 * check below also verifies no empty `<datasources />` anchor survived.
 *
 * Usage:
 *   node apply-plan.mjs <unzipDir> <planJsonPath>
 *
 * Exits non-zero with a diagnostic on any failure, and after applying,
 * verifies no residual placeholder tokens remain in the finalized files.
 */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PLACEHOLDER_TOKENS = ['TODO-MANIFEST-ID', 'TODO App Name', 'TODO Username via Tableau MCP'];
const WIRING_ANCHOR_TOKEN = '<datasources />';

function die(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const [, , unzipDirArg, planPathArg] = process.argv;
if (!unzipDirArg || !planPathArg) {
  die('Usage: node apply-plan.mjs <unzipDir> <planJsonPath>');
}

const unzipDir = resolve(unzipDirArg);

let plan;
try {
  plan = JSON.parse(readFileSync(planPathArg, 'utf8'));
} catch (error) {
  die(`Could not read/parse plan JSON at ${planPathArg}: ${error.message}`);
}

const edits = Array.isArray(plan.edits) ? plan.edits : [];
const renames = Array.isArray(plan.renames) ? plan.renames : [];
if (edits.length === 0 && renames.length === 0) {
  die('Plan has no edits or renames — did you pass the full postUnzip object?');
}

// Guard against a plan path escaping the unzip dir.
function safeJoin(rel) {
  const abs = resolve(unzipDir, rel);
  if (abs !== unzipDir && !abs.startsWith(unzipDir + '/')) {
    die(`Plan path escapes the unzip directory: ${rel}`);
  }
  return abs;
}

// 1) Apply edits: literal (non-regex) find/replace on each file's contents.
for (const { file, replacements } of edits) {
  const abs = safeJoin(file);
  let content;
  try {
    content = readFileSync(abs, 'utf8');
  } catch (error) {
    die(`Edit target missing: ${file} (${error.message})`);
  }
  for (const { find, replace, occurrence } of replacements ?? []) {
    if (!content.includes(find)) {
      die(`Placeholder "${find}" not found in ${file} — template/plan out of sync.`);
    }
    if (occurrence === 'first') {
      const idx = content.indexOf(find);
      content = content.slice(0, idx) + replace + content.slice(idx + find.length);
    } else {
      content = content.split(find).join(replace);
    }
  }
  writeFileSync(abs, content, 'utf8');
  console.error(`  edited  ${file}`);
}

// 2) Apply renames in the given order (deepest-first, root last).
for (const { from, to } of renames) {
  try {
    renameSync(safeJoin(from), safeJoin(to));
  } catch (error) {
    die(`Rename failed: ${from} -> ${to} (${error.message})`);
  }
  console.error(`  renamed ${from} -> ${to}`);
}

// 3) The finalized workspace root is the target of the last rename.
const finalRootRel = renames.at(-1)?.to;
const finalRoot = finalRootRel ? safeJoin(finalRootRel) : unzipDir;

// 4) Verify no placeholder tokens survived in the substituted text files. The
//    substituted files are the edit targets, now living under the renamed root;
//    recompute their final paths by swapping the old root prefix for the new.
const oldRootRel = renames.find((r) => !r.from.includes('/'))?.from;
const residual = [];
for (const { file } of edits) {
  const finalRel =
    oldRootRel && finalRootRel && file.startsWith(oldRootRel + '/')
      ? finalRootRel + file.slice(oldRootRel.length)
      : file;
  let content;
  try {
    content = readFileSync(safeJoin(finalRel), 'utf8');
  } catch {
    continue;
  }
  const tokens = plan.wiresDatasource
    ? [...PLACEHOLDER_TOKENS, WIRING_ANCHOR_TOKEN]
    : PLACEHOLDER_TOKENS;
  for (const token of tokens) {
    if (content.includes(token)) {
      residual.push(`${finalRel}: "${token}"`);
    }
  }
}
if (residual.length > 0) {
  die(`Residual placeholders after finalize:\n  ${residual.join('\n  ')}`);
}

console.error(`✓ Finalized workspace at ${join(finalRoot)}`);
console.log(finalRoot);
