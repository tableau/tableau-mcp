import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Result } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { McpToolError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { projectDatasource, ProjectedDatasource } from './datasourceResult.js';
import { ListedDatasource, resolveDatasource } from './resolveDatasourceRef.js';

const paramsSchema = {
  session: sessionParam(),
  datasourceId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Datasource id as returned by the datasource list (already percent-encoded). A unique name or caption also works. Omit it to list every datasource.',
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
            callback: async (executor, signal, read) => {
              if (datasourceId === undefined) {
                const list = await read(
                  'workbook datasources',
                  async (executor, signal) => await executor.listWorkbookDatasources(signal),
                );
                return list.map((value) => ({
                  datasources: (value.datasources ?? []).map(projectDatasource),
                }));
              }
              const byId = await executor.getWorkbookDatasource(datasourceId, signal);
              const readById = async (): Promise<Result<ProjectedDatasource, McpToolError>> =>
                (await read('datasource metadata', async () => await Promise.resolve(byId))).map(
                  projectDatasource,
                );
              if (
                byId.isOk() ||
                byId.error.type !== 'command-failed' ||
                byId.error.error?.code !== 'datasource-not-found'
              ) {
                return await readById();
              }
              const list = await read(
                'workbook datasources',
                async (executor, signal) => await executor.listWorkbookDatasources(signal),
              );
              if (list.isErr()) {
                return list;
              }
              const candidates = (list.value.datasources ?? []).filter(
                (datasource): datasource is ListedDatasource =>
                  typeof datasource.id === 'string' && typeof datasource.name === 'string',
              );
              const resolved = resolveDatasource(datasourceId, candidates);
              if (resolved.isErr()) {
                return resolved.error.toErr();
              }
              if (resolved.value.id === datasourceId) {
                return await readById();
              }
              const datasource = await read(
                'datasource metadata',
                async (executor, signal) =>
                  await executor.getWorkbookDatasource(resolved.value.id, signal),
              );
              return datasource.map(projectDatasource);
            },
          }),
      });
    },
  });

  return getDatasources;
};
