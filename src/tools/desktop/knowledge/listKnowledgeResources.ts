import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { listKnowledgeResources } from '../../../desktop/knowledge/index.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {};

const toolTitle = 'List Knowledge Resources';
export const getListKnowledgeResourcesTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'list-knowledge-resources',
    title: toolTitle,
    description:
      'List available expertise modules (Tableau authoring knowledge). Each resource can be read with read-knowledge-resource using its URI (expertise://tableau/{slug}).',
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
        callback: async () => new Ok(listKnowledgeResources()),
        getSuccessResult: (resources) => ({
          content: [{ type: 'text', text: JSON.stringify({ resources }, null, 2) }],
        }),
      });
    },
  });
  return tool;
};
