import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { DesktopMcpServer } from '../../../server.desktop.js';
import { runExternalApiReadTool } from '../externalApiReadHarness.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: z.string().optional().describe('Session ID; optional if pinned or unique.'),
};
const title = 'Get Health';

export const getHealthTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const getHealth = new DesktopTool({
    server,
    name: 'get-health',
    title,
    description: 'Check External Client API liveness.',
    paramsSchema,
    annotations: {
      title,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await getHealth.logAndExecute({
        extra,
        args: { session },
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read('health', async (executor, signal) => await executor.health(signal)),
          });
        },
      });
    },
  });

  return getHealth;
};
