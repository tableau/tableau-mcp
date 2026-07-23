import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { DatasourceItem } from '../../../desktop/externalApi/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};

const title = 'List Workbook Datasources';
export const getListWorkbookDatasourcesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listWorkbookDatasources = new DesktopTool({
    server,
    name: 'list-workbook-datasources',
    title,
    description:
      "List the workbook's OWN connected datasources (id/name/caption; luid for published, non-federated ones).",
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listWorkbookDatasources.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'workbook datasources',
                async (executor, signal) => await executor.listWorkbookDatasources(signal),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          return new Ok({
            datasources: (result.value.datasources ?? []).map(projectDatasource),
          });
        },
      });
    },
  });

  return listWorkbookDatasources;
};

function projectDatasource(datasource: DatasourceItem): {
  id?: string;
  luid?: string;
  name?: string;
  caption?: string;
} {
  return {
    ...(datasource.id !== undefined ? { id: datasource.id } : {}),
    // The API emits luid: null for embedded/federated datasources; only surface a real LUID.
    ...(typeof datasource.luid === 'string' ? { luid: datasource.luid } : {}),
    ...(datasource.name !== undefined ? { name: datasource.name } : {}),
    ...(datasource.caption !== undefined ? { caption: datasource.caption } : {}),
  };
}
