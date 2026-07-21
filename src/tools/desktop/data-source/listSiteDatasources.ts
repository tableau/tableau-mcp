import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { SiteDatasourceItem } from '../../../desktop/externalApi/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};

const title = 'List Site Datasources';
export const getListSiteDatasourcesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listSiteDatasources = new DesktopTool({
    server,
    name: 'list-site-datasources',
    title,
    description:
      'List datasources PUBLISHED to the connected site (LUID; contentUrl when build provides it). Map workbook connections to published datasource LUIDs.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listSiteDatasources.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            toolName: listSiteDatasources.name,
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'site datasources',
                async (executor, signal) => await executor.listSiteDatasources(signal),
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

  return listSiteDatasources;
};

function projectDatasource(datasource: SiteDatasourceItem): {
  id?: string;
  luid?: string;
  name?: string;
  contentUrl?: string;
} {
  const contentUrl = (datasource as Record<string, unknown>)['contentUrl'];
  return {
    ...(datasource.id !== undefined ? { id: datasource.id } : {}),
    ...(datasource.luid !== undefined ? { luid: datasource.luid } : {}),
    ...(datasource.name !== undefined ? { name: datasource.name } : {}),
    ...(typeof contentUrl === 'string' ? { contentUrl } : {}),
  };
}
