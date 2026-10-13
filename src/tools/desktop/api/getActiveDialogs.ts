import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DIALOG_ACTION_INPUTS, DialogList } from '../../../desktop/externalApi/types.js';
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
    minApiVersion: '0.2.23',
    title,
    description:
      'List current dialog blockers and capabilities. Only active dialogs advertise actions. Copy the exact identity into invoke-dialog-action; send the chosen action kind and values required by its input.fields, honoring its constraints. recentActions reports bounded sanitized completion status.',
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
        callback: async () => {
          const result = await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call(
                'active dialogs',
                async (executor, signal) => await executor.getActiveDialogs(signal),
                { stableNotFoundMeansRouteMissing: true },
              ),
          });
          return result.map(withActionInputMetadata);
        },
      });
    },
  });

  return tool;
};

function withActionInputMetadata(result: DialogList): DialogList {
  return {
    ...result,
    dialogs: result.dialogs.map((dialog) => ({
      ...dialog,
      actions: dialog.actions?.map((action) => ({
        ...action,
        input: DIALOG_ACTION_INPUTS[action.kind],
      })),
    })),
  };
}
