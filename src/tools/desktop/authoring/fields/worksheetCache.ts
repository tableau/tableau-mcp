import { writeFileSync } from 'fs';
import { Err, Ok, Result } from 'ts-results-es';

import { DesktopCache } from '../../../../desktop/cache.js';
import { sourceSha256, writeSidecar } from '../../../../desktop/wrappers/cacheFingerprint.js';
import { getWorksheetXml, isRouteMissing } from '../../../../desktop/wrappers/getWorksheetXml.js';
import {
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
  McpToolError,
  UnknownError,
} from '../../../../errors/mcpToolError.js';
import { TableauDesktopRequestHandlerExtra } from '../../toolContext.js';

/** Shared with {@link worksheetEditBuffer.ts} so a sheet name maps to the same cache key everywhere. */
export function safeWorksheetCacheId(worksheetName: string): string {
  return worksheetName.replace(/[^a-zA-Z0-9]/g, '_');
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
  writeSidecar(cacheFile, resolvedSession, sourceSha256(fetched.value));
  return Ok(cacheFile);
}
