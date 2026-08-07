import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import {
  endpointNotInThisBuild,
  isRouteMissing,
  resolveItemByNameOrId,
} from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetSort } from '../../../desktop/externalApi/types.js';
import { resolveSession } from '../../../desktop/session/sessionResolution.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  worksheet: z.string().describe('Worksheet name/id to sort.'),
  fieldName: z.string().min(1).describe('Field to sort by (e.g. "[Superstore].[Sales]").'),
  direction: z.enum(['asc', 'desc']).optional().describe('Sort direction; defaults to asc.'),
  sortType: z
    .enum(['data-source-order', 'alpha'])
    .optional()
    .describe('Sort type; defaults to data-source-order.'),
  clearSort: z
    .boolean()
    .optional()
    .describe('Clear the sort on the field instead of applying one.'),
};
const title = 'Sort Worksheet';

export const getSortWorksheetTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const sortWorksheetTool = new DesktopTool({
    server,
    name: 'sort-worksheet',
    title,
    description: 'Apply or clear a sort on a field of a worksheet without opening the sort dialog.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async (
      { session, worksheet, fieldName, direction, sortType, clearSort },
      extra,
    ): Promise<CallToolResult> => {
      return await sortWorksheetTool.logAndExecute({
        extra,
        args: { session, worksheet, fieldName, direction, sortType, clearSort },
        callback: async () => {
          const sessionResult = resolveSession(session);
          if (sessionResult.isErr()) {
            return sessionResult.error.toErr();
          }

          const idResult = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const worksheets = await read(
                'worksheet list',
                async (executor, signal) => await executor.listWorksheets(signal),
              );
              if (worksheets.isErr()) {
                return worksheets;
              }
              const resolved = resolveItemByNameOrId(
                'Worksheet',
                worksheet,
                worksheets.value.worksheets ?? [],
              );
              if (resolved.isErr()) {
                return resolved.error.toErr();
              }
              return new Ok(resolved.value);
            },
          });
          if (idResult.isErr()) {
            return idResult.error.toErr();
          }

          const sort: WorksheetSort = {
            fieldName,
            ...(direction ? { direction } : {}),
            ...(sortType ? { sortType } : {}),
            ...(clearSort !== undefined ? { clearSort } : {}),
          };

          const executor = await extra.getExecutor(sessionResult.value);
          const result = await executor.sortWorksheet(idResult.value.id, sort, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('sort-worksheet').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          return new Ok({
            worksheet: { id: idResult.value.id, name: idResult.value.name },
            fieldName,
            message:
              result.value.status === 'completed'
                ? clearSort
                  ? `Cleared the sort on "${fieldName}" in worksheet "${idResult.value.name}".`
                  : `Sorted worksheet "${idResult.value.name}" by "${fieldName}".`
                : `Requested sort on worksheet "${idResult.value.name}"; Desktop is still applying it.`,
          });
        },
      });
    },
  });

  return sortWorksheetTool;
};
