import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { readKnowledgeResource, readKnowledgeSections } from '../../../desktop/knowledge/index.js';
import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { DesktopMcpServer } from '../../../server.desktop.js';
import { DesktopTool } from '../tool.js';

const paramsSchema = {
  uri: z.string().describe('expertise://tableau/{slug}, +#section for a section'),
};

const toolTitle = 'Reading authoring guide';
export const getReadKnowledgeResourceTool = (
  server: DesktopMcpServer,
): DesktopTool<typeof paramsSchema> => {
  const tool = new DesktopTool({
    server,
    name: 'read-knowledge-resource',
    title: toolTitle,
    description: 'Read expertise by URI; search-knowledge finds URIs.',
    paramsSchema,
    annotations: {
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
            // A bad #section is a different mistake from a bad module — name the sections
            // this module actually has rather than sending the agent back to the URI list.
            const hash = uri.indexOf('#');
            const sections =
              hash === -1
                ? []
                : readKnowledgeSections(uri.slice('expertise://tableau/'.length, hash));
            if (sections.length > 0) {
              return new ArgsValidationError(
                `No section "${uri.slice(hash + 1)}" in ${uri.slice(0, hash)}.\n\nSections: ${sections.join(', ')}`,
              ).toErr();
            }
            return new ArgsValidationError(
              `Resource not found: ${uri}\n\nUse search-knowledge to find available resource URIs.`,
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
