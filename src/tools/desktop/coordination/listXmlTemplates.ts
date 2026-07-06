import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { existsSync, readdirSync } from 'fs';
import { Ok } from 'ts-results-es';

import { getTemplatesDir } from '../../../desktop/templates/templatePath.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {};

const toolTitle = 'List Available XML Templates';
export const getListXmlTemplatesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'list-xml-templates',
    title: toolTitle,
    description:
      'List all available XML visualization templates. Use template names with build-and-apply-worksheet.',
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
          const templatesDir = getTemplatesDir();
          if (!existsSync(templatesDir)) {
            return new Ok({
              message: `No templates directory found at ${templatesDir}.`,
              templates: [],
            });
          }

          const files = readdirSync(templatesDir)
            .filter((f) => f.endsWith('.xml'))
            .map((f) => f.replace('.xml', ''))
            .sort();

          if (files.length === 0) {
            return new Ok({ message: `No templates found in ${templatesDir}.`, templates: [] });
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
