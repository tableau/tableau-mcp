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
  nodeType: z
    .enum(['PDS', 'WORKBOOK'])
    .optional()
    .describe('Filter sources to published data sources or workbooks.'),
  limit: z.number().int().positive().max(100).optional().describe('Maximum sources returned.'),
};

export const getListKnowledgeSourcesTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'list-knowledge-sources',
    description:
      "Lists published data sources and workbooks in an explicit Tableau Cloud knowledge graph for browsing available sources and obtaining source IDs. A source's top-level id is a Knowledge graph node ID; use properties.luid as the Tableau content LUID when present. The graph ID must come from Tableau Knowledge configuration or a prior workflow; do not invent one.",
    paramsSchema,
    annotations: {
      title: 'List Knowledge Sources',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configuredLimit = (await extra.getConfigWithOverrides()).getMaxResultLimit(tool.name);
      const limit = Math.min(args.limit ?? 100, configuredLimit ?? 100, 100);
      return tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const sources = await useRestApi({
            ...extra,
            jwtScopes: tool.requiredApiScopes,
            callback: (restApi) =>
              restApi.knowledgeMethods.listKnowledgeSources({
                graphId: args.graphId,
                nodeType: args.nodeType,
              }),
          });
          const limited = sources.slice(0, limit);
          return new Ok({
            sources: limited,
            mcp: {
              resultInfo: {
                returnedCount: limited.length,
                totalAvailable: sources.length,
                truncated: limited.length < sources.length,
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
