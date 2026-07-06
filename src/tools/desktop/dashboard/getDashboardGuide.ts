import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Ok } from 'ts-results-es';

import { FileNotFoundError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer, RESOURCES_ROOT } from '../../../server.desktop.js';
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
          const guidePath = join(RESOURCES_ROOT, 'dashboard-xml-guide.md');
          if (!existsSync(guidePath)) {
            return new FileNotFoundError(guidePath).toErr();
          }
          return new Ok(readFileSync(guidePath, 'utf-8'));
        },
        getSuccessResult: (guide) => ({
          content: [{ type: 'text', text: guide }],
        }),
      });
    },
  });
  return tool;
};
