import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { WebTool } from '../tool.js';
import { knowledgeGraphIdSchema } from './semanticStatementSchemas.js';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;

const paramsSchema = {
  graphId: knowledgeGraphIdSchema,
  pdsId: z.string().max(256).optional().describe('Scope the report to one PDS subtree.'),
  severity: z.enum(['high', 'medium', 'low']).optional(),
  type: z.string().max(128).optional().describe('Filter suggestions by suggestion type.'),
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe('Maximum number of top suggestions to return.'),
};

export const getGetKnowledgeSuggestionsTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'get-knowledge-suggestions',
    description:
      "Returns the full health report and improvement suggestions for a Tableau Cloud knowledge graph. Omit graphId to report on the site's default graph, or pass one from Tableau Knowledge configuration or a prior workflow; do not invent a graph ID. Suggestions can be filtered by PDS, severity, and type.",
    paramsSchema,
    annotations: {
      title: 'Get Knowledge Suggestions',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const maxResultLimit = (await extra.getConfigWithOverrides()).getMaxResultLimit(tool.name);
      const limit = Math.min(args.limit ?? DEFAULT_LIMIT, maxResultLimit ?? MAX_LIMIT, MAX_LIMIT);

      return tool.logAndExecute({
        extra,
        args,
        callback: async () =>
          new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: (restApi) =>
                restApi.knowledgeMethods.getKnowledgeSuggestions({ ...args, limit }),
            }),
          ),
        constrainSuccessResult: (report) => ({ type: 'success', result: report }),
      });
    },
  });

  return tool;
};
