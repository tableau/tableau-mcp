import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { LocalExecutor } from '../../desktop/toolExecutor/localToolExecutor.js';
import { UnknownError } from '../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../server.desktop.js';
import { getExceptionMessage } from '../../utils/getExceptionMessage.js';
import { DesktopTool } from './tool.js';

const paramsSchema = {};

export const getPlaceholderTool = (server: DesktopMcpServer): DesktopTool<typeof paramsSchema> => {
  const placeholderTool = new DesktopTool({
    server,
    name: 'placeholder-desktop-tool',
    description: 'This is a placeholder tool for the desktop.',
    paramsSchema,
    annotations: {
      title: 'Placeholder Desktop Tool',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (_, extra): Promise<CallToolResult> => {
      return await placeholderTool.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          const executor = new LocalExecutor();
          await executor.start();

          const eventsResult = await executor.getEvents();
          if (eventsResult.isErr()) {
            return new UnknownError(
              `Failed to get events. Reason: ${getExceptionMessage(eventsResult.error)}`,
            ).toErr();
          }
          return eventsResult;
        },
      });
    },
  });

  return placeholderTool;
};
