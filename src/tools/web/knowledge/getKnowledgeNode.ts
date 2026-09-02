import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';

const paramsSchema = {
  graphId: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,128}$/)
    .refine((value) => value !== '.' && value !== '..')
    .optional()
    .describe("Knowledge graph ID. Omit to use the site's active (default) graph."),
  nodeId: z.string().trim().min(1).describe('Exact id of the node to fetch.'),
  includeChildren: z
    .boolean()
    .optional()
    .describe("Include the node's outgoing child nodes in connected_nodes. Defaults to true."),
};

export const getGetKnowledgeNodeTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'get-knowledge-node',
    description:
      'Fetches a single knowledge node by its exact id, returning its full properties, attached semantic statements, and directly connected child nodes. Requires an id you already have: take it from a search-knowledge-nodes match or a connected node in a relationship result. Do not use to resolve a natural-language reference; use search-knowledge-nodes for that. Set includeChildren=false to skip connected children.',
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
