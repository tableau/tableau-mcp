import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { knowledgeGraphIdSchema, knowledgePathIdSchema } from './semanticStatementSchemas.js';

const HARD_LIMIT = 100;
const paramsSchema = {
  graphId: knowledgeGraphIdSchema,
  nodeId: knowledgePathIdSchema
    .optional()
    .describe('Node whose attached and global statements apply.'),
  isGlobal: z.boolean().optional().describe('Graph search filter; unavailable with nodeId.'),
};

export const getListSemanticStatementsTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'list-knowledge-semantic-contexts',
    description:
      'Fallback-only statement lookup for an explicit Tableau Knowledge graph. Call this tool only to inspect global statements or when search-knowledge-nodes returned no attached statement that answers the question. Never call it for a node whose selected search match already contains the needed definition or formula; that would repeat the same evidence and add latency. With nodeId, results include statements attached to that node plus global statements. Results are capped at 100 or the configured result limit and include truncation metadata.',
    paramsSchema,
    annotations: {
      title: 'List Semantic Statements',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      return tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          if (args.nodeId !== undefined && args.isGlobal !== undefined) {
            throw new Error('isGlobal cannot be used with nodeId.');
          }
          const semanticStatements = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: (restApi) => restApi.knowledgeMethods.listSemanticStatements(args),
          });
          const configuredLimit = (await extra.getConfigWithOverrides()).getMaxResultLimit(
            tool.name,
          );
          const limit = Math.min(configuredLimit ?? HARD_LIMIT, HARD_LIMIT);
          const totalAvailable = semanticStatements.length;
          const limited = semanticStatements.slice(0, limit);
          return new Ok({
            semanticStatements: limited,
            mcp: {
              resultInfo: {
                returnedCount: limited.length,
                totalAvailable,
                truncated: limited.length < totalAvailable,
              },
            },
          });
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });
  return tool;
};
