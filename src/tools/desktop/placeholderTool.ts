import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { Server } from '../../server.js';
import { DesktopTool } from '../desktopTool.js';

const paramsSchema = {};

export const getPlaceholderTool = (server: Server): DesktopTool<typeof paramsSchema> => {
  const placeholderTool = new DesktopTool({
    server,
    name: 'placeholder-desktop-tool',
    description: 'This is a placeholder tool for the desktop.',
    paramsSchema,
    annotations: {
      title: 'List Datasources',
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
