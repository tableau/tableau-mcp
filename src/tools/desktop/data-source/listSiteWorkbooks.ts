import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { SiteWorkbookItem } from '../../../desktop/externalApi/types.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};

const title = 'List Site Workbooks';
export const getListSiteWorkbooksTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const listSiteWorkbooks = new DesktopTool({
    server,
    name: 'list-site-workbooks',
    title,
    description: 'List workbooks published to the connected site.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await listSiteWorkbooks.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'site workbooks',
                async (executor, signal) => await executor.listSiteWorkbooks(signal),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          return new Ok({
            workbooks: (result.value.workbooks ?? []).map(projectWorkbook),
          });
        },
      });
    },
  });

  return listSiteWorkbooks;
};

function projectWorkbook(workbook: SiteWorkbookItem): {
  id?: string;
  luid?: string;
  name?: string;
  project?: string;
} {
  return {
    ...(workbook.id !== undefined ? { id: workbook.id } : {}),
    ...(workbook.luid !== undefined ? { luid: workbook.luid } : {}),
    ...(workbook.name !== undefined ? { name: workbook.name } : {}),
    ...(workbook.project !== undefined ? { project: workbook.project } : {}),
  };
}
