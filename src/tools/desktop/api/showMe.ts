import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetShowMeRequest } from '../../../desktop/externalApi/types.js';
import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  worksheet: z.string().min(1).describe('Worksheet name or stable id used for discovery.'),
  showMeType: z
    .string()
    .min(1)
    .describe('Exact applicable showMeType returned by get-show-me-options.'),
  dataSource: z
    .string()
    .optional()
    .describe('Use the same optional internal Tableau datasource name used for discovery.'),
  fieldsSelectedInSchemaViewer: z
    .array(z.string())
    .optional()
    .describe(
      'Use the same ordered qualified field names used for discovery; omit only if discovery omitted them.',
    ),
};
const title = 'Show Me';

export const getShowMeTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const showMeTool = new DesktopTool({
    server,
    name: 'show-me',
    minApiVersion: '0.2.11',
    title,
    description:
      'Apply one Show Me recommendation. Call get-show-me-options first, then use only a returned showMeType whose isApplicable value is true. Preserve the same worksheet, dataSource, and fieldsSelectedInSchemaViewer context from discovery.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async (
      { session, worksheet, showMeType, dataSource, fieldsSelectedInSchemaViewer },
      extra,
    ): Promise<CallToolResult> => {
      return await showMeTool.logAndExecute({
        extra,
        args: { session, worksheet, showMeType, dataSource, fieldsSelectedInSchemaViewer },
        callback: async () => {
          return await withApplyLock(async () => {
            return await runExternalApiTool({
              session,
              extra,
              callback: async (_executor, _signal, call) => {
                const worksheets = await call(
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

                const request: WorksheetShowMeRequest = {
                  showMeType,
                  ...(dataSource !== undefined ? { dataSource } : {}),
                  ...(fieldsSelectedInSchemaViewer !== undefined
                    ? { fieldsSelectedInSchemaViewer }
                    : {}),
                };
                const result = await call(
                  'show-me',
                  async (executor, signal) =>
                    await executor.showMeWorksheet(resolved.value.id, request, signal),
                );
                if (result.isErr()) {
                  return result;
                }

                const { id, name } = resolved.value;
                return new Ok({
                  showMeRequested: true,
                  operationStatus: result.value.status,
                  worksheet: { id, name },
                  showMeType,
                  message:
                    result.value.status === 'completed'
                      ? `Desktop accepted Show Me type "${showMeType}" for worksheet "${name}". The resulting visualization was not independently verified.`
                      : `Requested Show Me type "${showMeType}" for worksheet "${name}"; Desktop is still applying it.`,
                });
              },
            });
          });
        },
      });
    },
  });

  return showMeTool;
};
