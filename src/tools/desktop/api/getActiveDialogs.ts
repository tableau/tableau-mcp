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
    minApiVersion: '0.2.12',
    title,
    description:
      'List the current actionable Tableau Desktop dialogs, including their exact identity, visible message and diagnostic text, and invokable actions. Text buttons retain their exact labels; recognized unlabeled controls use semantic actions such as close. Returns an empty dialogs array when no dialog needs a decision.',
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
