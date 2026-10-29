import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DialogList } from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Get Active Dialogs';

export const getActiveDialogsTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-active-dialogs',
    minApiVersion: '0.2.26',
    title,
    description:
      'List the current actionable Tableau Desktop dialogs with their exact session identity (sessionId, revision), visible message text, and advertised action capabilities, plus the status of recent dialog action requests. Returns an empty dialogs array when no dialog needs a decision.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<DialogList>({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'active dialogs',
                async (executor, signal) => await executor.getActiveDialogs(signal),
                { stableNotFoundMeansRouteMissing: true },
              ),
          }),
      });
    },
  });

  return tool;
};
