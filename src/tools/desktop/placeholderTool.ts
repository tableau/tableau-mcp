import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { DesktopMcpServer } from '../../server.desktop.js';
import { DesktopTool } from '../tool.desktop.js';

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
          return new Ok('placeholder');
        },
      });
    },
  });

  return placeholderTool;
};
