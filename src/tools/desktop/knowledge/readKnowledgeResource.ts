import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { readKnowledgeResource } from '../../../desktop/knowledge/index.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  uri: z
    .string()
    .describe(
      "Resource URI, e.g. 'expertise://tableau/strategy/viz-design/chart-selection'. Use list-knowledge-resources to see available URIs.",
    ),
};

const toolTitle = 'Read Knowledge Resource';
export const getReadKnowledgeResourceTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'read-knowledge-resource',
    title: toolTitle,
    description:
      'Read an expertise module by URI (e.g., expertise://tableau/tactics/viz/filters). Use list-knowledge-resources to enumerate available URIs.',
    paramsSchema,
    annotations: {
      title: toolTitle,
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ uri }, extra): Promise<CallToolResult> => {
      return await tool.logAndExecute({
        extra,
        args: { uri },
        callback: async () => {
          const content = readKnowledgeResource(uri);
          if (content === null) {
            return new ArgsValidationError(
              `Resource not found: ${uri}\n\nUse list-knowledge-resources to see available URIs.`,
            ).toErr();
          }
          return new Ok(content);
        },
        getSuccessResult: (content) => ({
          content: [{ type: 'text', text: content }],
        }),
      });
    },
  });
  return tool;
};
