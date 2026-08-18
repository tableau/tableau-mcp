import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

const paramsSchema = {
  graphId: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,128}$/)
    .refine((value) => value !== '.' && value !== '..')
    .describe('Knowledge graph ID.'),
  query: z.string().trim().min(1).describe('Natural-language description of the nodes to find.'),
  nodeType: z.string().trim().min(1).optional().describe('Optional knowledge node type filter.'),
  scopeId: z.string().trim().min(1).optional().describe('Optional source/container node ID scope.'),
  limit: z.number().int().positive().max(MAX_LIMIT).optional().describe('Maximum ranked matches.'),
};

export const getSearchKnowledgeNodesTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'search-knowledge-nodes',
    description:
      'Semantically searches nodes in an explicit Tableau Cloud knowledge graph. The graph ID must come from Tableau Knowledge configuration or a prior workflow; do not invent one.',
    paramsSchema,
    annotations: {
      title: 'Search Knowledge Nodes',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configuredLimit = (await extra.getConfigWithOverrides()).getMaxResultLimit(tool.name);
      const limit = Math.min(args.limit ?? DEFAULT_LIMIT, configuredLimit ?? MAX_LIMIT, MAX_LIMIT);
      return tool.logAndExecute({
        extra,
        args,
        callback: async () =>
          new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: (restApi) =>
                restApi.knowledgeMethods.searchKnowledgeNodes({ ...args, limit }),
            }),
          ),
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });
  return tool;
};
