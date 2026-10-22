import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';
import { projectDatasource } from './datasourceResult.js';

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
      'List every datasource in the open workbook, including ones no sheet uses and the built-in Parameters datasource (type parameters) when the workbook defines parameters. ' +
      'Each has id/name/caption/type; isExtract = extract vs live. The id is percent-encoded: pass it back as-is, not re-encoded. ' +
      'luid appears only for a published datasource when Desktop is signed in to its site; hasDownloadFilePermission for published ones.',
    paramsSchema,
    annotations: {
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
