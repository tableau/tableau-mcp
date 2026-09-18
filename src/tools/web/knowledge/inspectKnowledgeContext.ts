import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { severitySchema } from '../../../sdks/tableau/types/knowledge.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import {
  flattenKnowledgeStatements,
  getKnowledgeResultLimit,
  graphIdSchema,
  resultLimitSchema,
} from './knowledgeToolUtils.js';

const optionalGraphIdSchema = graphIdSchema
  .optional()
  .describe("Knowledge graph ID. Omit to use the site's primary graph.");
const limitSchema = resultLimitSchema.describe(
  'Maximum returned graphs, suggestions, or statements.',
);

const paramsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), limit: limitSchema }).strict(),
  z
    .object({
      action: z.literal('list'),
      graphId: optionalGraphIdSchema,
      nodeId: z.string().trim().min(1).max(512).optional().describe('Exact Knowledge node ID.'),
      isGlobal: z.boolean().optional().describe('Filter by graph-wide status.'),
      limit: limitSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('suggestions'),
      graphId: optionalGraphIdSchema,
      pdsId: z.string().trim().min(1).max(512).optional().describe('Published data source ID.'),
      severity: severitySchema.optional().describe('Suggestion severity filter.'),
      suggestionType: z
        .string()
        .trim()
        .min(1)
        .max(200)
        .optional()
        .describe('Suggestion type filter.'),
      limit: limitSchema,
    })
    .strict(),
]);

export const getInspectKnowledgeContextTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'inspect-knowledge-context',
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('knowledge-tools')),
    ),
    minRequiredRole: SiteRole.VIEWER,
    registrationConditions: ['RequiresKnowledge'],
    description: `
Inspects Tableau Knowledge through one read-only entry point. Use action="status" to discover
graphs, "list" to inspect existing semantic context, and "suggestions" to review graph-health
recommendations and coverage. Use manage-knowledge-context only when the user wants to create,
update, or delete context.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Inspect Knowledge Context',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configuredLimit = (await extra.getConfigWithOverrides()).getMaxResultLimit(tool.name);
      const limit = getKnowledgeResultLimit(args.limit, configuredLimit);

      return await tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: async (restApi) => {
                const methods = restApi.knowledgeMethods;
                switch (args.action) {
                  case 'status': {
                    const graphs = await methods.listGraphs();
                    return {
                      action: args.action,
                      graphs: graphs.slice(0, limit),
                      primaryGraph: graphs.find((graph) => graph.is_primary) ?? null,
                      resultInfo: listResultInfo('Graph', graphs.length, limit),
                    };
                  }
                  case 'list': {
                    const contexts = await methods.listSemanticStatements({
                      graphId: args.graphId,
                      nodeId: args.nodeId,
                      isGlobal: args.isGlobal,
                    });
                    return {
                      action: args.action,
                      ...flattenKnowledgeStatements({
                        contexts,
                        scope: args.isGlobal && !args.nodeId ? 'global' : undefined,
                        limit,
                      }),
                    };
                  }
                  case 'suggestions': {
                    const report = await methods.getKnowledgeSuggestions({
                      graphId: args.graphId,
                      pdsId: args.pdsId,
                      severity: args.severity,
                      type: args.suggestionType,
                      limit,
                    });
                    return {
                      action: args.action,
                      healthScore: report.health_score ?? null,
                      stats: report.stats,
                      metrics: report.metrics.slice(0, limit),
                      summary: report.summary,
                      suggestions: report.suggestions.slice(0, limit),
                      errors: report.errors.slice(0, limit),
                      resultInfo: listResultInfo('Suggestion', report.suggestions.length, limit),
                    };
                  }
                }
              },
            }),
          );
        },
        constrainSuccessResult: (result) => ({ type: 'success', result }),
      });
    },
  });

  return tool;
};

function listResultInfo(
  label: string,
  original: number,
  limit: number,
): Record<string, number | boolean> {
  return {
    [`original${label}Count`]: original,
    [`returned${label}Count`]: Math.min(original, limit),
    truncated: original > limit,
  };
}
