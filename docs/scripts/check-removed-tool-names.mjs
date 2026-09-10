// Docs ↔ tool-registry consistency guard.
//
// When a Tableau MCP tool is removed or renamed, its old kebab-case name must
// not linger in the published docs: a stale name misleads readers into calling
// a tool that no longer exists. This has happened before — the docs kept naming
// the removed `get-stale-content-report` tool after it was folded into
// `query-admin-insights` (with `kind: "stale-content"`).
//
// This guard fails when any deny-listed (removed/renamed) tool name appears as a
// standalone token under docs/docs. It is deliberately a deny-list of REMOVED
// names rather than an allow-list diff against the live registry: a registry
// diff would false-positive on legitimate kebab tokens such as the
// query-admin-insights `kind` values (stale-content, ts-events, ts-users,
// site-content, job-performance) and REST operation ids.
//
// Scope: only files under docs/docs (the Docusaurus content root) are scanned.
//
// To extend: when you remove or rename a tool, add its old name to
// REMOVED_TOOL_NAMES below.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REMOVED_TOOL_NAMES = [
  // Consolidated into `query-admin-insights` (kind: "stale-content"); the
  // standalone tool was removed in PR #860.
  'get-stale-content-report',
];

const DOC_EXTENSIONS = ['.md', '.mdx'];

/** Recursively collect files with a docs extension under `rootDir`. */
function collectDocFiles(rootDir) {
  const files = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // Skip dependency/tooling dirs that could contain unrelated markdown.
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      files.push(...collectDocFiles(join(rootDir, entry.name)));
    } else if (DOC_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(join(rootDir, entry.name));
    }
  }
  return files;
}

/**
 * Build a matcher that hits `name` only as a standalone kebab token, so a longer
 * identifier that merely contains a removed name (hypothetically
 * `get-stale-content-report-v2`) does not trigger a false positive.
 */
function tokenRegex(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`);
}

const MATCHERS = REMOVED_TOOL_NAMES.map((name) => ({ name, re: tokenRegex(name) }));

/**
 * Scan every doc file under `rootDir` for references to removed tool names.
 * @returns {{ filesScanned: number, violations: Array<{file:string,line:number,name:string,snippet:string}> }}
 */
export function findRemovedToolNameReferences(rootDir) {
  const files = collectDocFiles(rootDir);
  const violations = [];
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      for (const { name, re } of MATCHERS) {
        if (re.test(text)) {
          violations.push({ file, line: i + 1, name, snippet: text.trim() });
        }
      }
    });
  }
  return { filesScanned: files.length, violations };
}

// Default docs root: <repo>/docs/docs, resolved relative to this script so the
// guard works regardless of the current working directory.
export const DEFAULT_DOCS_ROOT = fileURLToPath(new URL('../docs', import.meta.url));

function main() {
  // Optional positional arg overrides the docs root (used by the tests to point
  // the CLI at fixtures); defaults to the real docs/docs tree.
  const rootArg = process.argv[2];
  const rootDir = rootArg ? resolve(process.cwd(), rootArg) : DEFAULT_DOCS_ROOT;

  const { filesScanned, violations } = findRemovedToolNameReferences(rootDir);

  // A guard that scans nothing must never pass: zero files means the docs root
  // moved or was mis-resolved, not that the docs are clean.
  if (filesScanned === 0) {
    console.error(
      `✖ docs tool-name guard scanned 0 doc files under ${rootDir}. ` +
        'The docs root may have moved; refusing to pass vacuously.',
    );
    process.exit(1);
  }

  if (violations.length > 0) {
    console.error('✖ Docs reference removed/renamed tool names:\n');
    for (const v of violations) {
      console.error(`  ${relative(process.cwd(), v.file)}:${v.line}  ->  "${v.name}"`);
      console.error(`      ${v.snippet}`);
    }
    console.error(
      `\n${violations.length} reference(s) found. These tools were removed or renamed; ` +
        'update the docs to the current tool name (e.g. "get-stale-content-report" -> ' +
        '"query-admin-insights" with kind: "stale-content").',
    );
    console.error(
      '\nIf a name flagged here is in fact still a live tool, remove it from ' +
        'REMOVED_TOOL_NAMES in docs/scripts/check-removed-tool-names.mjs.',
    );
    process.exit(1);
  }

  console.log(
    `✓ docs tool-name guard: no removed tool names in ${filesScanned} doc file(s) ` +
      `(deny-list: ${REMOVED_TOOL_NAMES.join(', ')}).`,
  );
}

// Run as a CLI only when invoked directly (not when imported by the test).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
