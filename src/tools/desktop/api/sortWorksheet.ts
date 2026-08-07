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
import { ArgsValidationError, DesktopCommandExecutionError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { resolveShelfField } from './resolveShelfField.js';

const paramsSchema = {
  session: sessionParam(),
  worksheet: z.string().describe('Worksheet name/id to sort.'),
  fieldName: z
    .string()
    .min(1)
    .describe(
      'Field to sort by, given as the field name as it appears on the worksheet (e.g. "Sales").',
    ),
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

          const resolvedResult = await runExternalApiReadTool({
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

              const document = await read(
                'worksheet document',
                async (executor, signal) =>
                  await executor.getWorksheetDocument(resolved.value.id, signal),
              );
              if (document.isErr()) {
                return document;
              }

              const shelfField = resolveShelfField(document.value.xml, fieldName);
              if (!shelfField.ok) {
                return new ArgsValidationError(
                  `Field "${fieldName}" is not on worksheet "${resolved.value.name}"'s shelves, so it cannot be sorted. ` +
                    (shelfField.onShelf.length > 0
                      ? `Fields on this worksheet: ${shelfField.onShelf.join(', ')}.`
                      : 'This worksheet has no fields on its shelves.'),
                ).toErr();
              }
              return new Ok({
                id: resolved.value.id,
                name: resolved.value.name,
                column: shelfField.column,
              });
            },
          });
          if (resolvedResult.isErr()) {
            return resolvedResult.error.toErr();
          }

          const sort: WorksheetSort = {
            fieldName: resolvedResult.value.column,
            ...(direction ? { direction } : {}),
            ...(sortType ? { sortType } : {}),
            ...(clearSort !== undefined ? { clearSort } : {}),
          };

          const executor = await extra.getExecutor(sessionResult.value);
          const result = await executor.sortWorksheet(resolvedResult.value.id, sort, extra.signal);
          if (result.isErr()) {
            if (isRouteMissing(result.error)) {
              return endpointNotInThisBuild('sort-worksheet').toErr();
            }
            return new DesktopCommandExecutionError(result.error).toErr();
          }

          const { name: worksheetName, column } = resolvedResult.value;
          return new Ok({
            worksheet: { id: resolvedResult.value.id, name: worksheetName },
            fieldName: column,
            message:
              result.value.status === 'completed'
                ? clearSort
                  ? `Cleared the sort on "${column}" in worksheet "${worksheetName}".`
                  : `Sorted worksheet "${worksheetName}" by "${column}".`
                : `Requested sort on worksheet "${worksheetName}"; Desktop is still applying it.`,
          });
        },
      });
    },
  });

  return sortWorksheetTool;
};
