import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WORKSPACE_EXTENSIONS_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
import { WorkspaceExtensionList } from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Get workspace extensions';

export const getWorkspaceExtensionsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-workspace-extensions',
    minApiVersion: WORKSPACE_EXTENSIONS_MIN_API_VERSION,
    title,
    description:
      'Lists the workspace extensions installed in Tableau Desktop, including disabled ones. ' +
      'Each id stays the same across sessions; use it to reload the extension.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<WorkspaceExtensionList>({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'GET /v0/app/extensions',
                async (executor, signal) => await executor.listWorkspaceExtensions(signal),
                { stableNotFoundMeansRouteMissing: true },
              ),
          }),
      });
    },
  });

  return tool;
};
