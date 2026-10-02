import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DesktopState } from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Get Tableau Desktop State';

export const getDesktopStateTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-desktop-state',
    minApiVersion: '0.2.14',
    title,
    description:
      'Report whether Tableau Desktop is idle or blocked, the strongest observed blocking cause, all active native activities, UI snapshot completeness, and visible modal or progress window content. When a modal needs action, obtain fresh exact identity and actions from get-active-dialogs before considering invoke-dialog-action.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<DesktopState>({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'Desktop state',
                async (executor, signal) => await executor.getDesktopState(signal),
                { stableNotFoundMeansRouteMissing: true },
              ),
          }),
      });
    },
  });

  return tool;
};
