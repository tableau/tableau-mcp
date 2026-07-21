import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};
const title = 'Get API Root';

export const getApiRootTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getApiRoot = new DesktopTool({
    server,
    name: 'get-api-root',
    title,
    description: 'Read API root.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await getApiRoot.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read('API root', async (executor, signal) => await executor.getRoot(signal)),
          });
          return result;
        },
      });
    },
  });

  return getApiRoot;
};
