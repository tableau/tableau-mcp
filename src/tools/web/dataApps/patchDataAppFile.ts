import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { getDataAppWorkspaceStore } from '../../../dataApps/init.js';
import { appIdSchema } from '../../../dataApps/opaqueId.js';
import type { DataAppFileInput } from '../../../dataApps/types.js';
import {
  DataAppFileNotFoundError,
  DataAppPatchAmbiguousMatchError,
  DataAppPatchAnchorNotFoundError,
  DataAppPatchNotTextError,
  DataAppPatchStaleError,
  DataAppWorkspaceLimitExceededError,
  McpToolError,
  UnsafeWorkspacePathError,
} from '../../../errors/mcpToolError.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { fileDigest } from './fileDigest.js';
import { allowedOriginsParam, updateManifestAllowedOrigins } from './manifestOrigins.js';
import { resolveScopeFromExtra } from './scopeFromExtra.js';

const paramsSchema = {
  appId: appIdSchema,
  edits: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .describe('Workspace-relative POSIX path of the file to edit, e.g. "src/app.js".'),
        oldString: z
          .string()
          .min(1)
          .describe(
            'The exact current text to replace. Must match the file byte-for-byte, including ' +
              'indentation and line breaks. Must match exactly one location unless `replaceAll` is ' +
              'true. Include enough surrounding context to be unique.',
          ),
        newString: z
          .string()
          .describe('The replacement text. May be empty to delete the matched text.'),
        replaceAll: z
          .boolean()
          .optional()
          .default(false)
          .describe(
            'When true, replace every occurrence of `oldString`. When false (default), `oldString` ' +
              'must match exactly one location or the edit is rejected as ambiguous.',
          ),
        expectedDigest: z
          .string()
          .optional()
          .describe(
            'Optional per-file digest from a prior read/search/patch response. If supplied and it ' +
              'no longer matches the file, the edit is rejected as stale instead of patching ' +
              'content the caller no longer has an accurate picture of.',
          ),
      }),
    )
    .min(1)
    .describe(
      'One or more anchor-based edits applied as a single atomic batch, possibly across different ' +
        'files. Every edit is validated before anything is written; if any edit fails, nothing in ' +
        'the batch is written. Edits targeting the same file apply in array order against the ' +
        'progressively-updated content.',
    ),
  allowedOrigins: allowedOriginsParam,
};

export type PatchDataAppFileResult = {
  files: Array<{
    /** Workspace-relative POSIX path of the patched file. */
    path: string;
    /** Byte size of the file after the batch. */
    bytes: number;
    /** Total number of occurrences replaced in this file across all its edits. */
    matched: number;
    /** Per-file digest after the batch — pass back as `expectedDigest` to chain further edits. */
    digest: string;
  }>;
  /** Whole-workspace content digest after the batch, identical in meaning to `upsert-data-app-files`. */
  digest: string;
};

/**
 * Applies anchor-based find/replace edits to existing data-app workspace files without resending the
 * whole file — the write cost scales with the edit, not the file size.
 *
 * Built entirely on the store's `listFiles`/`readFile`/`upsertFiles` primitives, so it inherits their
 * scope isolation, path containment, size/count limits, atomic-preflight, and protected-manifest
 * guarantees unchanged, and works against any workspace-store provider without provider-specific code.
 * Makes no Tableau REST API call.
 */
export const getPatchDataAppFileTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const patchDataAppFileTool = new WebTool({
    server,
    name: 'patch-data-app-file',
    description: `
Applies one or more anchor-based find/replace edits to existing files in a data-app workspace
(created by \`scaffold-data-app\`), so a small change to a large file costs tokens proportional to the
edit rather than the whole file. Same mental model as a standard code editor's find/replace. Use
\`upsert-data-app-files\` instead to create a new file or fully rewrite one. This tool makes no
Tableau REST API call.

All edits are validated before anything is written; if any edit fails, the whole batch is rejected
and nothing changes (same atomicity, path-containment, size limits, and protected-\`dataapp.json\`
rule as \`upsert-data-app-files\`). Edits targeting the same file apply in array order against the
progressively-updated content.

**Parameters:** \`appId\` (required) — the workspace handle. \`edits\` (required) — one or more
\`{ path, oldString, newString, replaceAll?, expectedDigest? }\` entries. \`oldString\` must match the
current file byte-for-byte (including indentation and line breaks) and must match exactly one
location unless \`replaceAll\` is true. \`newString\` may be empty to delete the matched text.
\`allowedOrigins\` (optional) — space-separated external origins the app may fetch/XHR at runtime;
declare them in the same call that patches in the fetch, or the published app's Content-Security-
Policy blocks the request and it fails silently on-screen. Omit to leave the current setting
unchanged; pass an empty string to clear it.

**Result:** \`{ files, digest }\`. \`files\` lists \`{ path, bytes, matched, digest }\` per patched
file (\`matched\` = occurrences replaced; \`digest\` = the file's new per-file digest, usable as a
later \`expectedDigest\`). \`digest\` is the whole-workspace digest after the batch.

**Errors** (react rather than retrying verbatim): \`data-app-file-not-found\` — the file isn't in the
workspace; create it with \`upsert-data-app-files\`. \`data-app-patch-anchor-not-found\` —
\`oldString\` isn't present; re-read the file and copy the exact current text. \`
data-app-patch-ambiguous-match\` — \`oldString\` matches more than one place; add surrounding context
or set \`replaceAll\`. \`data-app-patch-stale\` — \`expectedDigest\` no longer matches; re-read and
recompute. \`data-app-workspace-limit-exceeded\` — the result exceeds a size cap.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Patch Data App File',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return patchDataAppFileTool.logAndExecute<PatchDataAppFileResult>({
        extra,
        args,
        callback: async () => {
          // Own the protected-manifest contract up front, independently of the store provider, so a
          // patch can never target the tool-managed manifest even before any file is read.
          const protectedEdit = args.edits.find((edit) => isProtectedManifestPath(edit.path));
          if (protectedEdit) {
            return new UnsafeWorkspacePathError(
              `Cannot patch protected workspace file: ${protectedEdit.path}`,
            ).toErr();
          }

          const scope = resolveScopeFromExtra(extra);
          if (scope.isErr()) {
            return scope;
          }

          try {
            const store = getDataAppWorkspaceStore();
            // Read the same per-file cap the default store enforces, so we can bound the peak
            // allocation of a replacement BEFORE materializing it. The store re-validates at write
            // time and stays authoritative; this is a pre-flight guard against a tiny request
            // (huge replaceAll count × long newString) blowing up memory before the store ever sees it.
            const maxFileBytes = getConfig().dataApps.maxFileBytes;

            // One manifest lookup establishes that the workspace resolves for this scope (a bad/expired
            // appId throws data-app-workspace-not-found here) and lets us distinguish a missing file
            // (data-app-file-not-found) from a bad workspace before reading anything.
            const manifest = await store.listFiles(scope.value, args.appId);
            const manifestPaths = new Set(manifest.map((f) => f.path));

            // Working copy per touched file. Files are loaded lazily on first edit so we read each
            // target exactly once, then apply that file's edits in array order against this copy.
            const working = new Map<
              string,
              { text: string; byteLength: number; matched: number; preDigest: string }
            >();

            for (const edit of args.edits) {
              const path = normalizeWorkspacePath(edit.path);

              let entry = working.get(path);
              if (!entry) {
                if (!manifestPaths.has(path)) {
                  return new DataAppFileNotFoundError(
                    `File not found in workspace: ${path}. Create it with upsert-data-app-files instead of patching it.`,
                  ).toErr();
                }
                const bytes = await store.readFile(scope.value, args.appId, path);
                const buffer = Buffer.from(bytes);
                const text = buffer.toString('utf8');
                // Reject non-UTF-8 (binary) content: a lossy decode/re-encode round-trip would
                // corrupt the file on write, so refuse rather than silently damage it.
                if (!Buffer.from(text, 'utf8').equals(buffer)) {
                  return new DataAppPatchNotTextError(
                    `File is not valid UTF-8 text and cannot be patched: ${path}. Rewrite it whole with upsert-data-app-files.`,
                  ).toErr();
                }
                entry = {
                  text,
                  byteLength: buffer.length,
                  matched: 0,
                  preDigest: fileDigest(bytes),
                };
                working.set(path, entry);
              }

              if (edit.expectedDigest !== undefined && edit.expectedDigest !== entry.preDigest) {
                return new DataAppPatchStaleError(
                  `File changed since it was last read: ${path}. expectedDigest=${edit.expectedDigest} but current per-file digest=${entry.preDigest}. Re-read the file, recompute the edit, and retry.`,
                ).toErr();
              }

              const count = countOccurrences(entry.text, edit.oldString);
              if (count === 0) {
                return new DataAppPatchAnchorNotFoundError(
                  `oldString not found in ${path}. Re-read the file and copy the exact current text.${nearMissHint(entry.text, edit.oldString)}`,
                ).toErr();
              }
              if (count > 1 && !edit.replaceAll) {
                return new DataAppPatchAmbiguousMatchError(
                  `oldString matches ${count} locations in ${path}. Add surrounding context to make it unique, or set replaceAll: true.`,
                ).toErr();
              }

              // Bound peak memory: project the post-edit byte size with exact UTF-8 arithmetic and
              // reject before materializing if it would exceed the cap. Without this, a tiny request
              // (a small file of a repeated char + a long newString with replaceAll) could allocate
              // count × newString gigabytes and OOM the shared process before the store's write-time
              // size check ever runs.
              const replaced = edit.replaceAll ? count : 1;
              const oldBytes = Buffer.byteLength(edit.oldString, 'utf8');
              const newBytes = Buffer.byteLength(edit.newString, 'utf8');
              const projectedBytes = entry.byteLength - replaced * oldBytes + replaced * newBytes;
              if (projectedBytes > maxFileBytes) {
                return new DataAppWorkspaceLimitExceededError(
                  `Patch of ${path} would produce ${projectedBytes} bytes, exceeding the ${maxFileBytes}-byte per-file limit. Reduce newString or the number of replacements.`,
                ).toErr();
              }

              entry.text = edit.replaceAll
                ? replaceAllLiteral(entry.text, edit.oldString, edit.newString)
                : replaceFirst(entry.text, edit.oldString, edit.newString);
              entry.byteLength = projectedBytes;
              entry.matched += replaced;
            }

            // Single atomic write of every touched file. upsertFiles re-validates path containment,
            // per-file/workspace size limits, and the protected manifest before mutating anything.
            const batch: DataAppFileInput[] = [...working.entries()].map(([path, entry]) => ({
              path,
              content: entry.text,
            }));
            const upsertResult = await store.upsertFiles(scope.value, args.appId, batch);

            const files = [...working.entries()]
              .map(([path, entry]) => ({
                path,
                bytes:
                  upsertResult.files.find((f) => f.path === path)?.bytes ??
                  Buffer.byteLength(entry.text, 'utf8'),
                matched: entry.matched,
                digest: fileDigest(entry.text),
              }))
              .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

            // Declaring an origin rides along with the edit, so the author never touches the
            // protected manifest directly. Only when the param is present (empty clears it); the
            // manifest write is the last mutation, so its digest is the workspace's final digest.
            let digest = upsertResult.digest;
            if (args.allowedOrigins !== undefined) {
              const manifestWrite = await updateManifestAllowedOrigins(
                store,
                scope.value,
                args.appId,
                args.allowedOrigins,
              );
              digest = manifestWrite.digest;
            }

            return new Ok({ files, digest });
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

  return patchDataAppFileTool;
};

/** Count non-overlapping literal occurrences of `needle` in `haystack`. */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count++;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/** Replace the first literal occurrence of `needle` with `replacement`. */
function replaceFirst(haystack: string, needle: string, replacement: string): string {
  const index = haystack.indexOf(needle);
  if (index === -1) {
    return haystack;
  }
  return haystack.slice(0, index) + replacement + haystack.slice(index + needle.length);
}

// Accumulates into one output string so peak memory tracks output size (already capped by the
// projectedBytes guard), not occurrence count — unlike split/join, which allocates one array slot
// per match and can balloon on a file of many single-char matches.
function replaceAllLiteral(haystack: string, needle: string, replacement: string): string {
  let result = '';
  let from = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    result += haystack.slice(from, index) + replacement;
    from = index + needle.length;
    index = haystack.indexOf(needle, from);
  }
  return result + haystack.slice(from);
}

/**
 * When an anchor isn't found, explain the most likely reason so the caller can fix it in one retry
 * instead of guessing. Detects the two dominant causes: line-ending mismatch (CRLF vs LF) and
 * whitespace/indentation differences. Never mutates content — this is advisory text only.
 */
function nearMissHint(content: string, oldString: string): string {
  const stripCr = (s: string): string => s.replace(/\r/g, '');
  if (stripCr(content).includes(stripCr(oldString))) {
    return ' Hint: the anchor matches except for line endings (CRLF \\r\\n vs LF \\n) — re-copy the anchor from a fresh read of this file so its line endings match the stored content exactly.';
  }
  const collapseWhitespace = (s: string): string => s.replace(/\s+/g, ' ').trim();
  if (
    collapseWhitespace(oldString) !== '' &&
    collapseWhitespace(content).includes(collapseWhitespace(oldString))
  ) {
    return ' Hint: a whitespace-normalized version of the anchor is present — indentation or spacing differs from what you sent.';
  }
  return '';
}

/** Mirror the store's path normalization for manifest membership comparison (strip `./`, collapse `//`). */
function normalizeWorkspacePath(rawPath: string): string {
  return rawPath.replace(/^\.\//, '').replace(/\/+/g, '/');
}

function isProtectedManifestPath(path: string): boolean {
  return (
    path.replace(/^\.\//, '').replace(/\/+/g, '/').normalize('NFC').toLowerCase() === 'dataapp.json'
  );
}
