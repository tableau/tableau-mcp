import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { knowledgePathIdSchema } from './semanticStatementSchemas.js';
import { getTraversalLimit, truncateKnowledgeArrays } from './truncateKnowledgeTraversal.js';

const paramsSchema = {
  graphId: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,128}$/)
    .refine((value) => value !== '.' && value !== '..'),
  nodeId: knowledgePathIdSchema,
};

export const getGetKnowledgeNodeImpactTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'get-knowledge-node-impact',
    description:
      'Returns assets transitively affected by one node in an explicit Tableau Knowledge graph.',
    paramsSchema,
    annotations: {
      title: 'Get Knowledge Node Impact',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const limit = getTraversalLimit(
        (await extra.getConfigWithOverrides()).getMaxResultLimit(tool.name),
      );
      return tool.logAndExecute({
        extra,
        args,
        callback: async () =>
          new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: (restApi) => restApi.knowledgeMethods.getKnowledgeNodeImpact(args),
            }),
          ),
        constrainSuccessResult: (result) => ({
          type: 'success',
          result: truncateKnowledgeArrays(result, { affected_assets: 'Affected' }, limit),
        }),
      });
    },
  });
  return tool;
};
