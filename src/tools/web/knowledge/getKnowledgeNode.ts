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
    .describe('Knowledge graph ID.'),
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
      'Resolves a natural-language query to one full node with its match score, or returns sparse candidates when ambiguous, in an explicit Tableau Cloud knowledge graph.',
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
