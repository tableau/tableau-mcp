import { writeFileSync } from 'fs';
import { Err, Ok, Result } from 'ts-results-es';

import { DesktopCache } from '../../../desktop/cache.js';
import { writeSidecar } from '../../../desktop/commands/workbook/cacheFingerprint.js';
import {
  getWorksheetFragment,
  isRouteMissing,
} from '../../../desktop/commands/workbook/getWorksheetXml.js';
import {
  DesktopCommandExecutionError,
  GetWorksheetXmlFailedError,
  McpToolError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { TableauDesktopRequestHandlerExtra } from '../toolContext.js';

/**
 * Fetch an existing worksheet by display name and write it to a new cache file.
 *
 * This intentionally does not look up or reuse an existing cache path: the sidecar
 * proves Desktop instance identity, not workbook-content freshness.
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
  const fetched = await getWorksheetFragment({ worksheetName, executor, signal: extra.signal });
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

  const safeName = worksheetName.replace(/[^a-zA-Z0-9]/g, '_');
  const cacheFile = new DesktopCache().getCacheFilePath({ prefix: `worksheet-${safeName}` });
  writeFileSync(cacheFile, fetched.value, 'utf-8');
  writeSidecar(cacheFile, resolvedSession);
  return Ok(cacheFile);
}
