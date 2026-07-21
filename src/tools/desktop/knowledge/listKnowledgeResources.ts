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
      'List curated Tableau authoring expertise; consult before an unfamiliar build. Read one with read-knowledge-resource by URI (expertise://tableau/{slug}).',
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
        callback: async () => new Ok(listKnowledgeResources()),
        getSuccessResult: (resources) => ({
          content: [{ type: 'text', text: JSON.stringify({ resources }, null, 2) }],
        }),
      });
    },
  });
  return tool;
};
