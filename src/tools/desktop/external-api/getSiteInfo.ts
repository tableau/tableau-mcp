import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};
const title = 'Get Site Info';

export const getSiteInfoTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getSiteInfo = new DesktopTool({
    server,
    name: 'get-site-info',
    title,
    description: 'Read the connected Tableau site.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await getSiteInfo.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read('site', async (executor, signal) => await executor.getSite(signal)),
          });
        },
      });
    },
  });

  return getSiteInfo;
};
