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
  limit: z
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .describe('Maximum ranked matches; use 10 or less for one requested term.'),
};

export const getSearchKnowledgeNodesTool = (server: WebMcpServer): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'search-knowledge-nodes',
    description:
      "Semantically searches an explicit Tableau Cloud knowledge graph. Use this tool once first for governed business terms, definitions, metrics, fields, and formulas; for one requested term, set limit to 10 or less to reduce latency and irrelevant evidence. Search matches include their attached semantic statements: when a selected match's statement answers the meaning or formula question, treat that evidence as complete and do not call list-knowledge-semantic-statements for the same node. An attached statement can establish a governed definition or formula, but it is not a computed datasource value. When the governed formula's inputs are not bound to queryable fields, you cannot compute the value: state that it cannot be computed and name the missing inputs; do not substitute a different field or report a related aggregate, such as a total or average, as the metric's value. A term in the query is not scope evidence: when the answer must be scoped to a product, datasource, or field, call get-knowledge-node-relationships with the selected match's exact id. If that result establishes the requested scope, answer immediately; do not search again for the connected node or repeat either lookup. Prefer this tool over search-content or list-datasources, which find Tableau assets, and get-datasource-metadata, which returns technical metadata for an already selected datasource. If no graph ID is available from Tableau Knowledge configuration or a prior workflow, ask the user for it; do not invent, infer, or default one. If the search returns no governed match for the requested term, say so plainly; do not invent a definition or substitute a similarly named field or a related aggregate as the answer.",
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
