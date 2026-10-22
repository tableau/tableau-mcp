import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { AppInfo } from '../../../desktop/externalApi/types.js';
import { runExternalApiTool } from '../../../desktop/wrappers/readHarness.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { sessionParam } from '../params.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  session: sessionParam(),
};

const title = 'Get Tableau Desktop App Info';

export const getAppInfoTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-app-info',
    title,
    description:
      'Return application information for the running Tableau Desktop instance: application version, edition, build, operating system, locale, repository and log locations, and UI mode flags (isStartPageVisible, isDataSourcePageActive, isPresentationMode, isFocusMode). Every field the instance reports is returned. This describes the application and its current view mode; to check whether Desktop is idle or blocked by a dialog or activity, use get-desktop-state.',
    paramsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ session }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute<AppInfo>({
        extra,
        args: { session },
        callback: async () =>
          await runExternalApiTool({
            session,
            extra,
            callback: async (_executor, _signal, call) =>
              await call('App info', async (executor, signal) => await executor.getApp(signal)),
          }),
      });
    },
  });

  return tool;
};
