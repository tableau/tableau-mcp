import { resolveCacheFileArg } from '../../../../desktop/cachePath.js';
import { writeRedactedXmlCacheFileArg } from '../../../../desktop/limits/redactedXmlCache.js';
import { sourceSha256, writeSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { getWorkbookXml } from '../../../../desktop/wrappers/getWorkbookXml.js';
import { McpToolError, UnknownError } from '../../../../errors/mcpToolError.js';
import { getExceptionMessage } from '../../../../utils/getExceptionMessage.js';
import { TableauDesktopRequestHandlerExtra } from '../../toolContext.js';

/**
 * Outcome of a live workbook re-snapshot. `ok` carries the fresh XML; a failure
 * carries both a raw `reason` (for callers that degrade gracefully and want to
 * surface why) and a ready-to-return `error` McpToolError (for callers that
 * fail hard).
 */
export type RefreshResult =
  | { ok: true; xml: string }
  | { ok: false; reason: string; error: McpToolError };

/**
 * W-23447478 (P2a concurrency): the retry's "exactly once" is per-invocation, so
 * two concurrent callers against the same stale cache could each fire their own
 * live re-snapshot and RACE the cache/sidecar writes (duplicate snapshots,
 * last-writer-wins contents). This module-scope in-flight map keyed by
 * `workbookFile` dedups the refresh: a second concurrent caller awaits the SAME
 * promise instead of issuing another getWorkbookXml. The entry is cleared once
 * the refresh settles (success OR failure) so a later, non-overlapping call
 * refreshes again.
 */
const inflightWorkbookRefreshes = new Map<string, Promise<RefreshResult>>();

/**
 * W-23447478: a datasource connected AFTER the workbook cache was written is
 * invisible to a cache-only read — the P0 "agent doesn't recognize my
 * datasource" shape. Re-snapshot the live workbook, rewrite the cache file +
 * sidecar, and return the fresh XML.
 *
 * On an EXPLICIT refresh failure (getWorkbookXml returns Err, or the cache/sidecar
 * write throws) this returns `{ ok: false }` with the reason + a ready McpToolError
 * — never a silent stale fallback. If the underlying getWorkbookXml/getExecutor
 * REJECTS (transient executor/Agent-API fault) this rejects too, so callers choose
 * how to handle it: list-available-fields lets it throw (its unchanged behavior);
 * resolve-field degrades it gracefully (P1). Concurrent callers for the same
 * workbookFile share one refresh (P2a). Shared so the refresh mechanics stay
 * identical across the field tools.
 */
export async function refreshWorkbookCache({
  extra,
  workbookFile: requestedWorkbookFile,
  resolvedSession,
  action,
}: {
  extra: TableauDesktopRequestHandlerExtra;
  workbookFile: string;
  resolvedSession: string;
  action: string;
}): Promise<RefreshResult> {
  // Contain before the live round trip so an outside path never reaches Desktop or a write.
  const contained = resolveCacheFileArg('workbookFile', requestedWorkbookFile);
  if (contained.isErr()) {
    return { ok: false, reason: getExceptionMessage(contained.error), error: contained.error };
  }
  const workbookFile = contained.value;

  const inflight = inflightWorkbookRefreshes.get(workbookFile);
  if (inflight) return inflight;

  const refreshPromise: Promise<RefreshResult> = (async () => {
    const executor = await extra.getExecutor(resolvedSession);
    const result = await getWorkbookXml({ executor, signal: extra.signal });
    if (result.isErr()) {
      const reason = JSON.stringify(result.error);
      return {
        ok: false,
        reason,
        error: new UnknownError(
          `Failed to refresh workbook from Tableau before ${action}: ${reason}. Retry without session to read the cache as-is.`,
        ),
      };
    }

    const xml = result.value;
    const written = writeRedactedXmlCacheFileArg('workbookFile', workbookFile, xml);
    if (written.isErr()) {
      return { ok: false, reason: getExceptionMessage(written.error), error: written.error };
    }
    writeSidecar(written.value, resolvedSession, sourceSha256(xml));
    return { ok: true, xml };
  })();

  // Register the in-flight promise BEFORE awaiting so a concurrent caller dedups
  // onto it; clear it once settled (including rejection) so a rejected refresh
  // never wedges a permanently-stale entry.
  inflightWorkbookRefreshes.set(workbookFile, refreshPromise);
  try {
    return await refreshPromise;
  } finally {
    inflightWorkbookRefreshes.delete(workbookFile);
  }
}
