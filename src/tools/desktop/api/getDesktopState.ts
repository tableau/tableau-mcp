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
      'Report whether Tableau Desktop is idle or blocked and the strongest observed blocking cause, including registered native dialog blockers that may not be Qt windows. When a dialog needs action, obtain its fresh exact identity and advertised capability from get-active-dialogs before considering invoke-dialog-action. A partial UI snapshot is never evidence that no blocker exists.',
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
