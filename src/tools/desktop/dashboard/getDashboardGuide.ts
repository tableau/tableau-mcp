import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { readResourceAsset } from '../../../desktop/assets.js';
import { FileNotFoundError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {};

const toolTitle = 'Get Dashboard XML Guide';
export const getGetDashboardGuideTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'get-dashboard-guide',
    title: toolTitle,
    description:
      'Get comprehensive documentation on how to manually edit dashboard XML: zones, layouts, viewpoints, sizing, and best practices. Use this before hand-editing dashboard XML.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (_params, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: {},
        callback: async () => {
          const guide = readResourceAsset('dashboard-xml-guide.md');
          if (guide === null) {
            return new FileNotFoundError('dashboard-xml-guide.md').toErr();
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
