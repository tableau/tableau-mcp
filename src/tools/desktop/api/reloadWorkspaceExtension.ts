import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

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
    .describe('The id attribute of the workspace-extension element in the extension .trex file.'),
};
const title = 'Reload Workspace Extension';

export const getReloadWorkspaceExtensionTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const reloadWorkspaceExtensionTool = new DesktopTool({
    server,
    name: 'reload-workspace-extension',
    minApiVersion: '0.2.33',
    title,
    description:
      'Reload a repository Packages workspace extension without restarting Tableau Desktop. Succeeds without changes when the extension is not installed.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    paramsSchema,
    callback: async ({ session, extensionId }, extra): Promise<CallToolResult> => {
      return await reloadWorkspaceExtensionTool.logAndExecute({
        extra,
        args: { session, extensionId },
        getSuccessResult: commandSuccessResult,
        callback: async () => {
          return await runExternalApiReadTool({
            session,
            extra,
            callback: async (_executor, _signal, read) => {
              const result = await read(
                'reload-workspace-extension',
                async (executor, signal) =>
                  await executor.reloadWorkspaceExtension(extensionId, signal),
              );
              if (result.isErr()) {
                return result;
              }

              const subject =
                result.value.status === 'completed'
                  ? `Reloaded workspace extension "${extensionId}"`
                  : `Requested reload of workspace extension "${extensionId}"; Desktop is still applying it`;
              return new Ok(
                commandOk({ extensionId, message: `${subject}.` }, result.value, subject),
              );
            },
          });
        },
      });
    },
  });

  return reloadWorkspaceExtensionTool;
};
