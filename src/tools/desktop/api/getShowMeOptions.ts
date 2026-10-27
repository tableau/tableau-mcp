import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import type { ShowMeOptionsQuery } from '../../../desktop/externalApi/types.js';
import { resolveShowMeSelection } from '../../../desktop/metadata/showMeSelection.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  worksheet: z.string().min(1).describe('Worksheet name or stable id.'),
  dataSource: z.string().optional().describe('Optional datasource name or caption.'),
  fieldsSelectedInSchemaViewer: z
    .array(z.string())
    .optional()
    .describe(
      'Optional ordered fields. Captions and [datasource caption].[field] resolve to Tableau identities; omit for schema selection, [] selects none.',
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
    minApiVersion: '0.2.18',
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

              const needsMetadata =
                dataSource !== undefined || fieldsSelectedInSchemaViewer !== undefined;
              let query: ShowMeOptionsQuery = {};
              let expectedInstanceId: string | undefined;
              if (needsMetadata) {
                const metadata = await read(
                  'workbook document',
                  async (executor, signal) => await executor.getWorkbookDocument(signal),
                );
                if (metadata.isErr()) return metadata;
                const selection = resolveShowMeSelection(metadata.value.xml, {
                  dataSource,
                  fieldsSelectedInSchemaViewer,
                });
                if (selection.isErr()) return selection.error.toErr();
                query = selection.value;
                expectedInstanceId = metadata.value.instanceId;
              }

              return await read(
                'Show Me options',
                async (executor, signal) =>
                  await executor.getWorksheetShowMeOptions(
                    worksheetResult.value.id,
                    query,
                    signal,
                    expectedInstanceId,
                  ),
              );
            },
          });
        },
      });
    },
  });

  return getShowMeOptions;
};
