import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { projectDatasource, ProjectedDatasource } from './datasourceResult.js';

const paramsSchema = {
  session: sessionParam(),
  datasourceId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Datasource id as returned by the datasource list (already percent-encoded); not its name or caption. Omit it to list every datasource.',
    ),
};

const title = 'Get Datasources';

export const getDatasourcesTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getDatasources = new DesktopTool({
    server,
    name: 'get-datasources',
    title,
    description:
      'Without datasourceId, list every datasource in the open workbook, including ones no sheet uses and the Parameters datasource (type parameters). ' +
      'With datasourceId, get that one datasource. ' +
      'Each has id/name/caption/type; isExtract = extract vs live. The id is percent-encoded: pass it back as-is. ' +
      'luid appears only for a published datasource when Desktop is signed in to its site; hasDownloadFilePermission for published ones.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session, datasourceId }, extra): Promise<CallToolResult> => {
      return await getDatasources.logAndExecute({
        extra,
        args: { session, datasourceId },
        callback: async () =>
          await runExternalApiReadTool<
            { datasources: ProjectedDatasource[] } | ProjectedDatasource
          >({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              if (datasourceId === undefined) {
                const list = await read(
                  'workbook datasources',
                  async (executor, signal) => await executor.listWorkbookDatasources(signal),
                );
                return list.map((value) => ({
                  datasources: (value.datasources ?? []).map(projectDatasource),
                }));
              }
              const datasource = await read(
                'datasource metadata',
                async (executor, signal) =>
                  await executor.getWorkbookDatasource(datasourceId, signal),
              );
              return datasource.map(projectDatasource);
            },
          }),
      });
    },
  });

  return getDatasources;
};
