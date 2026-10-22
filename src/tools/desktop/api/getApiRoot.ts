import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { ApiRoot } from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Get External Client API Root';

export const getApiRootTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-api-root',
    title,
    description:
      'Read the External Client API root document of the Tableau Desktop instance. Returns the API version, the application version, and the map of links to API resources when the instance provides them.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<ApiRoot>({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call('API root', async (executor, signal) => await executor.getRoot(signal)),
          }),
      });
    },
  });

  return tool;
};
