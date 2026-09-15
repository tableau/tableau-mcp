import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import type { ShowMeOptionsQuery } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  worksheet: z.string().min(1).describe('Worksheet name or stable id.'),
  dataSource: z.string().optional().describe('Optional internal Tableau datasource name.'),
  fieldsSelectedInSchemaViewer: z
    .array(z.string())
    .optional()
    .describe(
      'Optional ordered qualified field names. Omit to use the current schema viewer selection; pass an empty array to explicitly select no fields.',
    ),
};
const title = 'Get Show Me Options';

export const getShowMeOptionsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const getShowMeOptions = new DesktopTool({
    server,
    name: 'get-show-me-options',
    title,
    description:
      "Call this before applying Show Me. Use only a returned showMeType whose isApplicable value is true; never invent or infer a type. If multiple applicable choices fit but the user's intent is unclear, ask the user to choose.",
    paramsSchema,
    minApiVersion: '0.2.14',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { session, worksheet, dataSource, fieldsSelectedInSchemaViewer },
      extra,
    ): Promise<CallToolResult> => {
      return await getShowMeOptions.logAndExecute({
        extra,
        args: { session, worksheet, dataSource, fieldsSelectedInSchemaViewer },
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const listResult = await read(
                'worksheet list',
                async (executor, signal) => await executor.listWorksheets(signal),
              );
              if (listResult.isErr()) {
                return listResult;
              }

              const worksheetResult = resolveItemByNameOrId(
                'Worksheet',
                worksheet,
                listResult.value.worksheets ?? [],
              );
              if (worksheetResult.isErr()) {
                return worksheetResult.error.toErr();
              }

              const query: ShowMeOptionsQuery = {
                ...(dataSource !== undefined ? { dataSource } : {}),
                ...(fieldsSelectedInSchemaViewer !== undefined
                  ? { fieldsSelectedInSchemaViewer }
                  : {}),
              };

              return await read(
                'Show Me options',
                async (executor, signal) =>
                  await executor.getWorksheetShowMeOptions(worksheetResult.value.id, query, signal),
              );
            },
          });
        },
      });
    },
  });

  return getShowMeOptions;
};
