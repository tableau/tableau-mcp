import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { ProtectedResourceMetadata } from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Get OAuth Protected Resource Metadata';

export const getOAuthProtectedResourceTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-oauth-protected-resource',
    title,
    description:
      'Return the OAuth protected-resource metadata (RFC 9728) published by the Tableau Desktop External Client API: the resource identifier and the supported bearer token methods. Read-only.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<ProtectedResourceMetadata>({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'OAuth protected resource metadata',
                async (executor, signal) => await executor.getOAuthProtectedResource(signal),
              ),
          }),
      });
    },
  });

  return tool;
};
