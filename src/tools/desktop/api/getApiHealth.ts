import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Get Tableau Desktop API Health';

export const getApiHealthTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-api-health',
    title,
    description:
      'Check whether the External Client API of a Tableau Desktop instance is enabled and responding. Returns { healthy: true } while the API is enabled and { healthy: false } otherwise, for example when the API is disabled.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<{ healthy: boolean }>({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call('API health', async (executor, signal) => await executor.health(signal)),
          }),
      });
    },
  });

  return tool;
};
