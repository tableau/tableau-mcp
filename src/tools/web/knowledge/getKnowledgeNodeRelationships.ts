import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { getTraversalLimit, truncateKnowledgeArrays } from './truncateKnowledgeTraversal.js';

const graphIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{1,128}$/)
  .refine((value) => value !== '.' && value !== '..');
const paramsSchema = {
  graphId: graphIdSchema.describe('Knowledge graph ID.'),
  nodeId: z.string().trim().min(1).optional().describe('Exact anchor node ID.'),
  query: z.string().trim().min(1).optional().describe('Natural-language anchor query.'),
  edgeType: z.string().trim().min(1).optional().describe('Optional edge type filter.'),
  direction: z.enum(['outgoing', 'incoming']).optional().describe('Optional direction filter.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .describe('Maximum relationships returned.'),
};

export const getGetKnowledgeNodeRelationshipsTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'get-knowledge-node-relationships',
    description:
      "Returns immediate relationships around one node in an explicit Tableau Knowledge graph. After search-knowledge-nodes, pass the selected match's exact id as nodeId; that id is already resolved, so do not also call get-knowledge-node. Use edgeType and direction for targeted one-hop inspection: DESCRIBES establishes scope, while CONTAINS and HAS expose source hierarchy. Check mcp.resultInfo.truncated before treating missing edges as evidence that no relationship exists. Do not search again for a connected node whose ID, name, and type are already returned. Use query only when no exact node ID is available.",
    paramsSchema,
    annotations: {
      title: 'Get Knowledge Node Relationships',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configuredLimit = (await extra.getConfigWithOverrides()).getMaxResultLimit(tool.name);
      const limit = getTraversalLimit(configuredLimit, args.limit);
      return tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          if (args.nodeId === undefined && args.query === undefined) {
            throw new Error('Provide at least one of nodeId or query.');
          }
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: (restApi) => restApi.knowledgeMethods.getKnowledgeNodeRelationships(args),
            }),
          );
        },
        constrainSuccessResult: (result) => ({
          type: 'success',
          result: truncateKnowledgeArrays(result, { edges: 'Edge' }, limit),
        }),
      });
    },
  });
  return tool;
};
