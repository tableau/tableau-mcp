import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { RefreshExtractRequest } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
  datasourceId: z
    .string()
    .min(1)
    .describe(
      "Datasource id from the workbook's datasource list; not its display name or caption.",
    ),
  isFullRefresh: z
    .boolean()
    .optional()
    .describe(
      'Force a full refresh. Omitted: incremental when the extract supports it, else full.',
    ),
};
const title = 'Refresh Datasource Extract';

export const getRefreshDatasourceExtractTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const refreshDatasourceExtractTool = new DesktopTool({
    server,
    name: 'refresh-datasource-extract',
    minApiVersion: '0.2.8',
    title,
    description:
      'Refresh the extract for a datasource in the open workbook. By default the refresh is incremental ' +
      'when the extract supports it; pass isFullRefresh to force a full refresh. A datasource with no ' +
      'refreshable extract does nothing.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true, // reaches the extract's backing source
    },
    paramsSchema,
    callback: async ({ session, datasourceId, isFullRefresh }, extra): Promise<CallToolResult> => {
      return await refreshDatasourceExtractTool.logAndExecute({
        extra,
        args: { session, datasourceId, isFullRefresh },
        callback: async () => {
          const request: RefreshExtractRequest =
            isFullRefresh !== undefined ? { isFullRefresh } : {};

          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const result = await read(
                'refresh-datasource-extract',
                async (executor, signal) =>
                  await executor.refreshDatasourceExtract(datasourceId, request, signal),
              );
              if (result.isErr()) {
                return result;
              }

              if (result.value.status !== 'completed') {
                return new Ok({
                  message: `Requested refreshing the extract for datasource "${datasourceId}"; Desktop is still applying it.`,
                });
              }

              return new Ok({
                message: `Refreshed the extract for datasource "${datasourceId}".`,
              });
            },
          });
        },
      });
    },
  });

  return refreshDatasourceExtractTool;
};
