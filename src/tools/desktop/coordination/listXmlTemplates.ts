import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { listTemplateNames } from '../../../desktop/templates/templatePath.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {};

const toolTitle = 'List Available Viz Templates';
export const getListXmlTemplatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'list-xml-templates',
    title: toolTitle,
    description:
      'List all available visualization templates. Use template names with build-and-apply-worksheet.',
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
          const files = listTemplateNames();

          if (files.length === 0) {
            return new Ok({ message: 'No templates found.', templates: [] });
          }

          return new Ok({
            message: `Available templates (${files.length}):\n\n${files.map((f) => `- ${f}`).join('\n')}\n\nUse these names with build-and-apply-worksheet.`,
            templates: files,
          });
        },
      });
    },
  });
  return tool;
};
