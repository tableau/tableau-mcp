import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { WORKSPACE_EXTENSIONS_MIN_API_VERSION } from '../../../desktop/externalApi/apiVersion.js';
import { runExternalApiReadTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';
import { commandOk, commandSuccessResult } from './desktopCommandResult.js';

const paramsSchema = {
  session: sessionParam(),
  extensionId: z
    .string()
    .min(1)
    .describe('Workspace extension id as returned by the workspace extension list; not its name.'),
};
const title = 'Reload Workspace Extension';

export const getReloadWorkspaceExtensionTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const reloadWorkspaceExtensionTool = new DesktopTool({
    server,
    name: 'reload-workspace-extension',
    minApiVersion: WORKSPACE_EXTENSIONS_MIN_API_VERSION,
    title,
    description:
      'Reload a workspace extension from the repository Packages folder so a new or changed ' +
      'extension shows up in the Extensions menu and toolbar, and reload any of its open pages ' +
      'without opening new ones. Also removes Packages extensions no longer in the folder. A ' +
      'disabled extension, or one not in the Packages folder, fails.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    paramsSchema,
    callback: async ({ session, extensionId }, extra): Promise<CallToolResult> => {
      return await reloadWorkspaceExtensionTool.logAndExecute({
        extra,
        args: { session, extensionId },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          const result = await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) =>
              await read(
                'reload-workspace-extension',
                async (executor, signal) =>
                  await executor.reloadWorkspaceExtension(extensionId, signal),
              ),
          });
          if (result.isErr()) {
            return result;
          }

          const subject =
            result.value.status === 'completed'
              ? `Reloaded workspace extension "${extensionId}"`
              : `Requested reload of workspace extension "${extensionId}"; Desktop is still applying it`;
          return new Ok(commandOk({ extensionId, message: `${subject}.` }, result.value, subject));
        },
      });
    },
  });

  return reloadWorkspaceExtensionTool;
};
