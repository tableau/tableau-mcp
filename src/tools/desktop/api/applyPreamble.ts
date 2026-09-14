import { Ok, Result } from 'ts-results-es';

import {
  CONTAINED_CACHE_READ_ISSUE,
  getCacheDir,
  readContainedCacheTextFile,
} from '../../../desktop/cachePath.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import {
  CacheArtifactKind,
  type CacheSidecarInput,
  checkSidecarInput,
  sidecarPath,
} from '../../../desktop/wrappers/cacheFingerprint.js';
import {
  ArgsValidationError,
  CacheSessionMismatchError,
  FileReadError,
  McpToolError,
  WorkbookNotFoundError,
  WorksheetNotFoundError,
} from '../../../errors/mcpToolError.js';
import { doneNextAction, receipt, StructuredResult, withNextAction } from '../structuredContent.js';

/**
 * Shared preamble for the apply-* tools' cached-file path: empty-path validation,
 * file existence, file read, session resolution, and the cache sidecar check.
 * Per-kind differences (focus mode, load thunk, success prose) stay in the tools.
 */
export function runApplyPreamble({
  kind,
  file,
  session,
  emptyPathGuidance,
  notFoundGuidance,
}: {
  kind: CacheArtifactKind;
  file: string | undefined;
  session: string | undefined;
  /** Where to get a path, appended to the empty-path validation error. */
  emptyPathGuidance: string;
  /** Where to get a path, appended to the missing-file error. */
  notFoundGuidance: string;
}): Result<{ xml: string; resolvedSession: string; sourceHash?: string }, McpToolError> {
  // No inline document parameter: the cached file path IS the handle. Making the
  // model retype a document cost ~190s of pure emission across six asks, and
  // inline content carried no cache fingerprint, so it also skipped the
  // cross-instance bleed guard below.
  if (!file?.trim()) {
    return new ArgsValidationError(
      `A non-empty ${kind} file path is required. ${emptyPathGuidance}`,
    ).toErr();
  }

  const readResult = readContainedCacheTextFile(file);
  if (!readResult.ok) {
    switch (readResult.issue) {
      case CONTAINED_CACHE_READ_ISSUE.outsideCache:
      case CONTAINED_CACHE_READ_ISSUE.unsafeFile:
        return new ArgsValidationError(
          `Security error: the ${kind} file must be a regular file contained in the Desktop cache directory.\n\n` +
            `Cache directory: ${getCacheDir()}\nRequested: ${file}`,
        ).toErr();
      case CONTAINED_CACHE_READ_ISSUE.missing: {
        const NotFoundError = kind === 'worksheet' ? WorksheetNotFoundError : WorkbookNotFoundError;
        return new NotFoundError(
          `Cached ${kind} file not found: ${file} ${notFoundGuidance}`,
        ).toErr();
      }
      case CONTAINED_CACHE_READ_ISSUE.readError:
        return new FileReadError(
          readResult.error ?? new Error(`Unable to read cached ${kind} file.`),
        ).toErr();
    }
  }

  const sessionResult = resolveSession(session);
  if (sessionResult.isErr()) {
    return sessionResult.error.toErr();
  }
  const resolvedSession = sessionResult.value;

  const metaFile = sidecarPath(readResult.path);
  const sidecarRead = readContainedCacheTextFile(metaFile);
  let sidecarInput: CacheSidecarInput;
  if (sidecarRead.ok) {
    sidecarInput = { type: 'read', text: sidecarRead.text };
  } else if (sidecarRead.issue === CONTAINED_CACHE_READ_ISSUE.missing) {
    sidecarInput = { type: 'missing' };
  } else {
    sidecarInput = {
      type: 'unreadable',
      error: sidecarRead.error ?? new Error(`Secure sidecar read rejected: ${sidecarRead.issue}`),
    };
  }

  // Cross-instance cache-bleed guard (W9): refuse a cache file produced by a
  // different (or restarted) Desktop session before applying it. Now that every
  // apply goes through a cache file, no payload can skip this check.
  const sidecar = checkSidecarInput(readResult.path, resolvedSession, kind, sidecarInput);
  if (!sidecar.ok) {
    return new CacheSessionMismatchError(sidecar.message!).toErr();
  }

  return new Ok({ xml: readResult.text, resolvedSession, sourceHash: sidecar.sourceHash });
}

type NoReadbackApplyKind = 'dashboard' | 'storyboard' | 'workbook' | 'datasource';

// Per-kind wording for the shared receipt below: what the unverified structure is
// called, and how the class of applies with no structural readback is named.
const NO_READBACK_WORDING: Record<NoReadbackApplyKind, { noun: string; scope: string }> = {
  dashboard: { noun: 'layout', scope: 'dashboard' },
  storyboard: { noun: 'structure', scope: 'storyboard' },
  workbook: { noun: 'structure', scope: 'whole workbook' },
  datasource: { noun: 'structure', scope: 'datasource' },
};

/**
 * Shared success result for the apply-* tools that have NO structural readback:
 * dispatch and the preflight warnings from the load result were observed; the applied
 * structure was not, so it is listed as unverified rather than claimed.
 */
export function acceptedNoReadbackApplyResult({
  kind,
  appliedName,
  resultWarnings,
  hostVerification,
}: {
  kind: NoReadbackApplyKind;
  /** Sheet name for the per-sheet applies; a whole-workbook apply names none. */
  appliedName?: string;
  /** Preflight validation warnings observed on the load result. */
  resultWarnings: readonly unknown[];
  /** Host verification line appended to the message text. */
  hostVerification: string;
}): StructuredResult<{ message: string }> {
  const { noun, scope } = NO_READBACK_WORDING[kind];
  const target = appliedName === undefined ? '' : ` for "${appliedName}"`;
  const subject = appliedName === undefined ? 'command' : `for "${appliedName}"`;
  const capitalized = kind.charAt(0).toUpperCase() + kind.slice(1);
  return withNextAction(
    {
      message: `Successfully applied ${kind} update${target}. The ${kind} has been updated.${hostVerification}`,
    },
    doneNextAction(
      receipt({
        did: [
          `Desktop accepted the ${kind} XML apply ${subject}`,
          `preflight validation returned ${resultWarnings.length} warning(s)`,
        ],
        unverified: [
          `whether the applied ${kind} retained its intended ${noun} — no structural readback ran (${scope} applies have none)`,
        ],
      }),
      `${capitalized} apply accepted — ${noun} not re-read`,
    ),
  );
}
