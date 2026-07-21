import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { readResourceAsset } from '../../../desktop/assets.js';
import { FileNotFoundError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {};

const toolTitle = 'Get Dashboard Layout Editing Guide';
export const getGetDashboardGuideTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-dashboard-guide',
    title: toolTitle,
    description: 'Read dashboard layout guide.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (_params, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          const guide = readResourceAsset('dashboard-xml-guide.md');
          if (guide === null) {
            return new FileNotFoundError('dashboard layout guide').toErr();
          }
          return new Ok(guide);
        },
        getSuccessResult: (guide) => ({
          content: [{ type: 'text', text: guide }],
        }),
      });
    },
  });
  return tool;
};
