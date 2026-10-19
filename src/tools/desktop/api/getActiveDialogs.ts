import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DIALOG_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
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
    minApiVersion: DIALOG_MIN_API_VERSION,
    title,
    description:
      'List blockers. Only active dialogs advertise actions. Copy the exact ' +
      'identity into invoke-dialog-action with the chosen action kind and required input.fields, ' +
      'honoring constraints. action is flat: {kind, path, filterId, overwriteConfirmed} for a ' +
      'save; kind and input.fields names are sibling keys. Never nest input or fields in action. ' +
      'While pending, inspect again on the same Desktop session; match ' +
      'recentActions by requestId and sessionId from the receipt. These reads are not mutation ' +
      'retries and need no further permission. Empty dialogs does not prove closure. Never replay. ' +
      'Any authorized next action needs a fresh active identity, capability and new requestId.',
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
