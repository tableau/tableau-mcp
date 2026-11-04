import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { DIALOG_SESSION_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
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
    minApiVersion: DIALOG_SESSION_MIN_API_VERSION,
    title,
    description:
      'List dialogs with sessionId/revision, visible message and diagnostic text, actions, and recentActions statuses. Text buttons keep exact labels; native panels advertise file, color, or print capabilities. Empty dialogs only confirms no blockers when uiSnapshotAvailable is true. Poll pending requests; never replay an uncertain action with a new requestId. File actions use path(s), filterId and overwriteConfirmed; color uses red/green/blue and optional alpha; print uses printerId, range, sheetScope, firstPage/lastPage, copies, collate, exportSelection and optional outputPath.',
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
