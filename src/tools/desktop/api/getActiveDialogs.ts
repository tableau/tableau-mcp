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
      'List sessionId/revision, status, visible message and diagnostic text, and recentActions. Native panels advertise capabilities; act only when active/enabled. Files: path(s), filterId, overwriteConfirmed with user consent; color: red/green/blue, alpha if supported; print: printerId, range, sheetScope, firstPage/lastPage, copies, collate, exportSelection, optional outputPath. Respect advertised bounds/support flags. Empty dialogs proves clear only with uiSnapshotAvailable. Poll pending requestId; never use a new ID for uncertainty. Panel closure or print-prepared is not caller success; verify the originating operation.',
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
