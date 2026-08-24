import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { knowledgeGraphIdSchema } from './semanticStatementSchemas.js';

const paramsSchema = {
  graphId: knowledgeGraphIdSchema,
  query: z.string().trim().min(1).describe('Natural-language description of the node to resolve.'),
  nodeType: z.string().trim().min(1).optional().describe('Optional knowledge node type filter.'),
  scopeId: z.string().trim().min(1).optional().describe('Optional source/container node ID scope.'),
  maxCandidates: z
    .number()
    .int()
    .min(1)
    .max(25)
    .optional()
    .describe('Maximum disambiguation candidates to return.'),
};

export const getGetKnowledgeNodeTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'get-knowledge-node',
    description:
      'Resolution-only lookup that returns full node properties when a natural-language reference has not already been resolved in a Tableau Cloud knowledge graph (omit graphId to use the default graph); ambiguous references return sparse candidates. Never call after search-knowledge-nodes selected a match with an exact id: use that search evidence directly and pass its id to relationship tools. Also do not call merely to expand a connected node whose ID, name, and type are already present in a relationship result.',
    paramsSchema,
    annotations: {
      title: 'Get Knowledge Node',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> =>
      tool.logAndExecute({
        extra,
        args,
        callback: async () =>
          new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: (restApi) => restApi.knowledgeMethods.getKnowledgeNode(args),
            }),
          ),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      }),
  });
  return tool;
};
