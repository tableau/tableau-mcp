import { writeFileSync } from 'fs';
import { Err, Ok, Result } from 'ts-results-es';

import { DesktopCache } from '../../../../desktop/cache.js';
import { resolveItemByNameOrId } from '../../../../desktop/externalApi/toolUtils.js';
import { writeSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { getWorksheetXml, isRouteMissing } from '../../../../desktop/wrappers/getWorksheetXml.js';
import { listWorksheets } from '../../../../desktop/wrappers/listWorksheets.js';
import {
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
  McpToolError,
  UnknownError,
} from '../../../../errors/mcpToolError.js';
import { TableauDesktopRequestHandlerExtra } from '../../toolContext.js';

/** Sanitize an id or name into a filesystem-safe cache-key segment (shared with {@link worksheetEditBuffer.ts}). */
export function safeWorksheetCacheId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '_');
}

/**
 * Resolve a caller's worksheet reference (id or display name) to the sheet's stable
 * `<simple-id uuid>` — the id the edit buffer keys on and the External Client API
 * addresses the sheet by. Best-effort: returns undefined (never throws) when the sheet
 * cannot be listed or matched, so callers fall back to the name only as a last resort.
 */
export async function resolveWorksheetSimpleId({
  worksheetRef,
  resolvedSession,
  extra,
}: {
  worksheetRef: string;
  resolvedSession: string;
  extra: TableauDesktopRequestHandlerExtra;
}): Promise<string | undefined> {
  const trimmed = worksheetRef.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const executor = await extra.getExecutor(resolvedSession);
    const listed = await listWorksheets({ executor, signal: extra.signal });
    if (listed.isErr()) {
      return undefined;
    }
    const identified = listed.value.worksheets.filter(
      (worksheet): worksheet is { id: string; name: string } => typeof worksheet.id === 'string',
    );
    const resolved = resolveItemByNameOrId('Worksheet', trimmed, identified);
    return resolved.isOk() ? resolved.value.id : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Fetch an existing worksheet by display name and write it to a new cache file.
 *
 * This intentionally does not look up or reuse an existing cache path: the sidecar
 * proves Desktop instance identity, not workbook-content freshness. Callers that want
 * edits to accumulate across name-only calls go through the sticky buffer in
 * {@link worksheetEditBuffer.ts} instead of calling this directly.
 */
export async function fetchAndCacheWorksheet({
  worksheetName,
  resolvedSession,
  extra,
}: {
  worksheetName: string;
  resolvedSession: string;
  extra: TableauDesktopRequestHandlerExtra;
}): Promise<Result<string, McpToolError>> {
  const executor = await extra.getExecutor(resolvedSession);
  const fetched = await getWorksheetXml({ worksheetName, executor, signal: extra.signal });
  if (fetched.isErr()) {
    const { type, error } = fetched.error;
    switch (type) {
      case 'get-worksheet-xml-error':
        return Err(new GetWorksheetXmlFailedError(error));
      case 'execute-command-error':
        if (isRouteMissing(error)) {
          return Err(
            new McpToolError({
              type: 'endpoint-not-in-this-build',
              message:
                'This Tableau Desktop build does not serve the worksheet document endpoint yet. ' +
                'Use list-worksheets to confirm the target sheet is visible, then retry on a Desktop build that serves worksheet documents.',
              statusCode: 404,
            }),
          );
        }
        return Err(new DesktopCommandExecutionError(error));
      default: {
        const _: never = type;
        return Err(new UnknownError(error));
      }
    }
  }

  const cacheFile = new DesktopCache().getCacheFilePath({
    prefix: `worksheet-${safeWorksheetCacheId(worksheetName)}`,
  });
  writeFileSync(cacheFile, fetched.value, 'utf-8');
  writeSidecar(cacheFile, resolvedSession);
  return Ok(cacheFile);
}
