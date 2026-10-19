import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { resolveItemByNameOrId } from '../../../desktop/externalApi/toolUtils.js';
import { WorksheetShowMeRequest } from '../../../desktop/externalApi/types.js';
import { resolveShowMeSelection } from '../../../desktop/metadata/showMeSelection.js';
import { withApplyLock } from '../../../desktop/wrappers/applyMutex.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  worksheet: z.string().min(1).describe('Worksheet name or stable id.'),
  showMeType: z.string().min(1).describe('Applicable showMeType returned by discovery.'),
  dataSource: z.string().optional().describe('Same optional datasource name or caption.'),
  fieldsSelectedInSchemaViewer: z
    .array(z.string())
    .optional()
    .describe(
      'Same optional fields. Captions and [datasource caption].[field] resolve; omit if discovery did, [] selects none.',
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
      'Apply a Show Me option. First call get-show-me-options, choose one marked applicable, and reuse its worksheet, data source, and selected fields.',
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

                const needsMetadata =
                  dataSource !== undefined || fieldsSelectedInSchemaViewer !== undefined;
                let selection: { dataSource?: string; fieldsSelectedInSchemaViewer?: string[] } =
                  {};
                let expectedInstanceId: string | undefined;
                if (needsMetadata) {
                  const metadata = await call(
                    'workbook document',
                    async (executor, signal) => await executor.getWorkbookDocument(signal),
                  );
                  if (metadata.isErr()) return metadata;
                  const resolvedSelection = resolveShowMeSelection(metadata.value.xml, {
                    dataSource,
                    fieldsSelectedInSchemaViewer,
                  });
                  if (resolvedSelection.isErr()) return resolvedSelection.error.toErr();
                  selection = resolvedSelection.value;
                  expectedInstanceId = metadata.value.instanceId;
                }
                const request: WorksheetShowMeRequest = { showMeType, ...selection };
                const result = await call(
                  'show-me',
                  async (executor, signal) =>
                    await executor.showMeWorksheet(
                      resolved.value.id,
                      request,
                      signal,
                      expectedInstanceId,
                    ),
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
