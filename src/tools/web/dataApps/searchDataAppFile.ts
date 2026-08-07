import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { getDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { appIdSchema } from '../../../dataApps/opaqueId.js';
import {
  ArgsValidationError,
  DataAppPatchNotTextError,
  McpToolError,
} from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { fileDigest } from './fileDigest.js';
import { runRegexSearch } from './runRegexSearch.js';
import { resolveScopeFromExtra } from './scopeFromExtra.js';

const paramsSchema = {
  appId: appIdSchema,
  path: z.string().min(1).describe('Workspace-relative POSIX path to search, e.g. "src/app.js".'),
  query: z
    .string()
    .min(1)
    .describe(
      'The text to find — a literal substring by default, or a regular expression if `isRegex` is true.',
    ),
  isRegex: z
    .boolean()
    .optional()
    .default(false)
    .describe('When true, `query` is a JavaScript regular expression tested against each line.'),
  caseSensitive: z
    .boolean()
    .optional()
    .default(true)
    .describe('When false, matching ignores case.'),
  contextLines: z
    .number()
    .int()
    .min(0)
    .max(20)
    .optional()
    .default(2)
    .describe('Number of lines of context to include before and after each matching line.'),
  maxMatches: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .default(50)
    .describe(
      'Maximum number of matching lines to return. `totalMatches`/`truncated` report if more exist.',
    ),
};

export type SearchDataAppFileMatch = {
  /** 1-based line number of the matching line. */
  line: number;
  /** The full text of the matching line. */
  text: string;
  /** Up to `contextLines` lines immediately before the match. */
  before: string[];
  /** Up to `contextLines` lines immediately after the match. */
  after: string[];
};

export type SearchDataAppFileResult = {
  path: string;
  /** Per-file digest of the searched file — usable as a `patch-data-app-file` `expectedDigest`. */
  digest: string;
  /** Total number of matching lines in the file (may exceed `matches.length`). */
  totalMatches: number;
  /** True when more than `maxMatches` matching lines exist and the list was truncated. */
  truncated: boolean;
  matches: SearchDataAppFileMatch[];
};

/**
 * Finds where text lives inside a single workspace file, returning matching line numbers with a few
 * lines of context, so a caller can locate an edit anchor without pulling the whole file back first.
 *
 * Complements `patch-data-app-file`: together they make the full read-edit-write loop scale with the
 * change rather than the file size. Built on the store's `readFile` primitive, so it inherits scope
 * isolation and path containment unchanged and works against any workspace-store provider. Makes no
 * Tableau REST API call.
 */
export const getSearchDataAppFileTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const searchDataAppFileTool = new WebTool({
    server,
    name: 'search-data-app-file',
    description: `
Searches a single file in a data-app workspace (created by \`scaffold-data-app\`) and returns the
matching line numbers with surrounding context — so you can locate a \`patch-data-app-file\` anchor in
a large file without reading the whole file back. This tool makes no Tableau REST API call and never
returns a filesystem path.

**Parameters:** \`appId\` (required) — the workspace handle. \`path\` (required) — the file to search.
\`query\` (required) — a literal substring, or a JS regular expression when \`isRegex\` is true.
Optional: \`caseSensitive\` (default true), \`contextLines\` (default 2), \`maxMatches\` (default 50).

**Result:** \`{ path, digest, totalMatches, truncated, matches }\`. Each match is
\`{ line, text, before, after }\` with 1-based line numbers. \`digest\` is the file's per-file digest,
usable directly as a \`patch-data-app-file\` \`expectedDigest\`.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Search Data App File',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return searchDataAppFileTool.logAndExecute<SearchDataAppFileResult>({
        extra,
        args,
        callback: async () => {
          const scope = resolveScopeFromExtra(extra);
          if (scope.isErr()) {
            return scope;
          }

          // Validate the regex before any store call so a bad or clearly-hostile pattern fails fast.
          let regexFlags: string | null = null;
          if (args.isRegex) {
            // Reject patterns prone to catastrophic backtracking before running them. This static
            // screen is a cheap first line of defense, not a proof of safety — the worker-thread
            // timeout below is the hard backstop for patterns it cannot detect.
            if (hasCatastrophicBacktracking(args.query)) {
              return new ArgsValidationError(
                'Regular expression rejected: it contains nested unbounded quantifiers (e.g. "(a+)+") ' +
                  'that can cause catastrophic backtracking. Rewrite it without a repeating quantifier ' +
                  'applied to an already-repeating group, or search with a literal substring instead.',
              ).toErr();
            }
            regexFlags = args.caseSensitive ? '' : 'i';
            try {
              // Compile once here purely to surface a syntax error cleanly before we spawn a worker.
              new RegExp(args.query, regexFlags);
            } catch (error) {
              return new ArgsValidationError(
                `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
              ).toErr();
            }
          }

          try {
            const bytes = await getDataAppWorkspaceStore().readFile(
              scope.value,
              args.appId,
              args.path,
            );
            const buffer = Buffer.from(bytes);
            const text = buffer.toString('utf8');
            if (!Buffer.from(text, 'utf8').equals(buffer)) {
              return new DataAppPatchNotTextError(
                `File is not valid UTF-8 text and cannot be searched as text: ${args.path}.`,
              ).toErr();
            }

            const lines = text.split(/\r?\n/);
            // A trailing newline yields a final empty element that isn't a real line; drop it so
            // line numbers, totals, and context slices don't reference a phantom line past EOF.
            // Guard on length > 1 so a genuinely empty file still reports its single empty line.
            if (lines.length > 1 && lines[lines.length - 1] === '') {
              lines.pop();
            }

            // Scan for matching line numbers. The regex path runs in a worker thread with a hard
            // timeout (ReDoS backstop); the literal path is linear and safe, so it runs inline.
            // Both produce 1-based `matchLines` capped at `maxMatches`, plus the true `totalMatches`.
            let totalMatches: number;
            let matchLines: number[];
            if (args.isRegex && regexFlags !== null) {
              ({ totalMatches, matchLines } = await runRegexSearch({
                lines,
                source: args.query,
                flags: regexFlags,
                maxMatches: args.maxMatches,
                timeoutMs: getConfig().dataApps.regexTimeoutMs,
              }));
            } else {
              const needle = args.caseSensitive ? args.query : args.query.toLowerCase();
              const test = (line: string): boolean =>
                (args.caseSensitive ? line : line.toLowerCase()).includes(needle);
              matchLines = [];
              totalMatches = 0;
              for (let i = 0; i < lines.length; i++) {
                if (!test(lines[i])) {
                  continue;
                }
                totalMatches++;
                if (matchLines.length < args.maxMatches) {
                  matchLines.push(i + 1);
                }
              }
            }

            // Assemble context from the caller-thread `lines` (single source of truth for slicing).
            const found: SearchDataAppFileMatch[] = matchLines.map((lineNumber) => {
              const i = lineNumber - 1;
              return {
                line: lineNumber,
                text: lines[i],
                before: lines.slice(Math.max(0, i - args.contextLines), i),
                after: lines.slice(i + 1, Math.min(lines.length, i + 1 + args.contextLines)),
              };
            });

            return new Ok({
              path: args.path,
              digest: fileDigest(bytes),
              totalMatches,
              truncated: totalMatches > found.length,
              matches: found,
            });
          } catch (error) {
            if (error instanceof McpToolError) {
              return error.toErr();
            }
            throw error;
          }
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return searchDataAppFileTool;
};

// Sticky-anchored so it matches a `{n}`/`{n,}`/`{n,m}` quantifier exactly at a given index without
// allocating a substring — keeps `readQuantifier` O(1) per probe regardless of the query length.
const BRACED_QUANTIFIER = /\{(\d+)(,(\d*))?\}/y;

/**
 * Reads an optional quantifier at `source[at]`, returning where it ends and whether it is
 * *unbounded* (can repeat without a fixed cap: `*`, `+`, `{n,}`). Fixed repetition (`?`, `{n}`,
 * `{n,m}`) is not the source of exponential backtracking, so it is reported as bounded. Returns
 * null when no quantifier is present. A trailing lazy/possessive marker (`?`/`+`) is consumed.
 */
function readQuantifier(source: string, at: number): { end: number; unbounded: boolean } | null {
  const c = source[at];
  if (c === undefined) {
    return null;
  }
  let unbounded: boolean;
  let end: number;
  if (c === '*' || c === '+') {
    unbounded = true;
    end = at + 1;
  } else if (c === '?') {
    unbounded = false;
    end = at + 1;
  } else if (c === '{') {
    BRACED_QUANTIFIER.lastIndex = at;
    const m = BRACED_QUANTIFIER.exec(source);
    if (!m) {
      return null; // a lone "{" is a literal in a JS regex, not a quantifier
    }
    const hasComma = m[2] !== undefined;
    const maxStr = m[3];
    // {n,} is unbounded; {n} and {n,m} are fixed-length and cannot blow up exponentially.
    unbounded = hasComma && (maxStr === undefined || maxStr === '');
    end = at + m[0].length;
  } else {
    return null;
  }
  if (source[end] === '?' || source[end] === '+') {
    end++; // lazy or possessive marker
  }
  return { end, unbounded };
}

/**
 * Rejects the most common ReDoS signature before a regex ever runs: an unbounded quantifier applied
 * to a subexpression that already contains one ("star height >= 2", e.g. `(a+)+`, `(a*)*`, `((\d+))+`),
 * the same heuristic the `safe-regex` package uses. This is a cheap pre-filter, not a complete
 * classifier — patterns it can't detect (e.g. overlapping alternations like `(a|aa)+`) pass through
 * and are stopped by the worker-thread timeout instead. Skips quantifier characters inside `[...]`
 * classes and after `\` escapes.
 */
export function hasCatastrophicBacktracking(source: string): boolean {
  // A stack with one entry per currently-open `(`. Each entry tracks whether that group has
  // seen an unbounded quantifier (`*`, `+`, `{n,}`) inside it. When a group closes and is itself
  // followed by an unbounded quantifier while this flag is set, that's the star-height >= 2
  // signature we reject.
  const groupHasUnbounded: boolean[] = [];

  const markUnbounded = (): void => {
    if (groupHasUnbounded.length > 0) {
      groupHasUnbounded[groupHasUnbounded.length - 1] = true;
    }
  };

  // Consume a quantifier that follows the atom ending at index `end` (a `)`, a `]`, or an escaped
  // char), marking the enclosing group and advancing the loop cursor. Returns the new cursor.
  const consumeQuantifierAfter = (end: number): number => {
    const q = readQuantifier(source, end + 1);
    if (!q) {
      return end;
    }
    if (q.unbounded) {
      markUnbounded();
    }
    return q.end - 1;
  };

  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++; // skip the escaped character, then bind any quantifier to it (e.g. "\d+")
      i = consumeQuantifierAfter(i);
      continue;
    }
    if (c === '[') {
      // Skip a character class: `*`/`+`/`{` inside are literals, not quantifiers.
      i++;
      if (source[i] === '^') {
        i++;
      }
      if (source[i] === ']') {
        i++; // a leading `]` is a literal member, not the class terminator
      }
      while (i < source.length && source[i] !== ']') {
        if (source[i] === '\\') {
          i++;
        }
        i++;
      }
      // `i` is at the closing `]` (or end); bind any quantifier to the class (e.g. "[a-z]+").
      i = consumeQuantifierAfter(i);
      continue;
    }
    if (c === '(') {
      groupHasUnbounded.push(false);
      continue;
    }
    if (c === ')') {
      const innerHadUnbounded = groupHasUnbounded.pop() ?? false;
      const q = readQuantifier(source, i + 1);
      if (q?.unbounded && innerHadUnbounded) {
        return true; // star height >= 2: unbounded quantifier over an already-unbounded group
      }
      // The group's subtree still contributes any unbounded repetition it (or its own quantifier)
      // holds to the enclosing scope, so deeper nesting is detected too.
      if (innerHadUnbounded || q?.unbounded) {
        markUnbounded();
      }
      if (q) {
        i = q.end - 1;
      }
      continue;
    }
    // A normal atom (literal, `.`, etc.) — consume any quantifier that follows it.
    i = consumeQuantifierAfter(i);
  }

  return false;
}
