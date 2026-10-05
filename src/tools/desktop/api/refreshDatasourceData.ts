import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

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
};
const title = 'Refresh Datasource Data';

export const getRefreshDatasourceDataTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const refreshDatasourceDataTool = new DesktopTool({
    server,
    name: 'refresh-datasource-data',
    minApiVersion: '0.2.8',
    title,
    description:
      'Refresh the live data for a datasource in the open workbook, reading it again from its source ' +
      '(the toolbar Refresh Data Source). This is not an extract refresh; for a datasource backed by ' +
      "an extract the data stays current only to the extract's date. A datasource with no connection to refresh does nothing.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true, // reaches the datasource's backing source
    },
    paramsSchema,
    callback: async ({ session, datasourceId }, extra): Promise<CallToolResult> => {
      return await refreshDatasourceDataTool.logAndExecute({
        extra,
        args: { session, datasourceId },
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const result = await read(
                'refresh-datasource-data',
                async (executor, signal) =>
                  await executor.refreshDatasourceData(datasourceId, signal),
              );
              if (result.isErr()) {
                return result;
              }

              if (result.value.status !== 'completed') {
                return new Ok({
                  message: `Requested refreshing datasource "${datasourceId}"; Desktop is still applying it.`,
                });
              }

              return new Ok({
                message: `Refreshed the live data for datasource "${datasourceId}".`,
              });
            },
          });
        },
      });
    },
  });

  return refreshDatasourceDataTool;
};
