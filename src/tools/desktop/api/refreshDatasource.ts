import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { RefreshExtractRequest } from '../../../desktop/externalApi/types.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';

const paramsSchema = {
  session: sessionParam(),
  datasourceId: z
    .string()
    .min(1)
    .describe('Datasource id from the datasource list (already percent-encoded), not its name.'),
  refreshType: z.enum(['data', 'extract']).describe('What to refresh.'),
  isFullRefresh: z
    .boolean()
    .optional()
    .describe('Extract only. Omitted: incremental when configured, else full.'),
};
const title = 'Refresh Datasource';

export const getRefreshDatasourceTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const refreshDatasourceTool = new DesktopTool({
    server,
    name: 'refresh-datasource',
    minApiVersion: '0.2.8',
    title,
    description:
      'Refresh a datasource in the open workbook: its live data (toolbar Refresh Data Source) or its extract. ' +
      'A credential prompt keeps it running until answered in Desktop; a connection failure ends FAILED, a declined one CANCELLED.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    paramsSchema,
    callback: async (
      { session, datasourceId, refreshType, isFullRefresh },
      extra,
    ): Promise<CallToolResult> => {
      return await refreshDatasourceTool.logAndExecute({
        extra,
        args: { session, datasourceId, refreshType, isFullRefresh },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          if (refreshType === 'data' && isFullRefresh !== undefined) {
            return new ArgsValidationError(
              'isFullRefresh applies only to refreshType extract. Omit it for a data refresh.',
            ).toErr();
          }

          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              if (refreshType === 'data') {
                const result = await read(
                  'datasource refreshData',
                  async (executor, signal) =>
                    await executor.refreshDatasourceData(datasourceId, signal),
                );
                if (result.isErr()) {
                  return result;
                }
                const subject =
                  result.value.status === 'completed'
                    ? `Refreshed the live data for datasource "${datasourceId}"`
                    : `Requested refreshing datasource "${datasourceId}"; Desktop is still applying it`;
                return new Ok(commandOk({ message: `${subject}.` }, result.value, subject));
              }

              const request: RefreshExtractRequest =
                isFullRefresh !== undefined ? { isFullRefresh } : {};
              const result = await read(
                'datasource refreshExtract',
                async (executor, signal) =>
                  await executor.refreshDatasourceExtract(datasourceId, request, signal),
              );
              if (result.isErr()) {
                return result;
              }
              const subject =
                result.value.status === 'completed'
                  ? `Refreshed the extract for datasource "${datasourceId}"`
                  : `Requested refreshing the extract for datasource "${datasourceId}"; Desktop is still applying it`;
              return new Ok(commandOk({ message: `${subject}.` }, result.value, subject));
            },
          });
        },
      });
    },
  });

  return refreshDatasourceTool;
};
