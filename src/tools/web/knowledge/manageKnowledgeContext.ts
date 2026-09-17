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

const statementInputSchema = z.object({
  statement: z.string().trim().min(1).max(10000),
  id: z.string().trim().min(1).max(512).nullable().optional(),
});
const optionalGraphIdSchema = graphIdSchema
  .optional()
  .describe("Knowledge graph ID. Omit to use the site's primary graph.");
const contextIdSchema = z.string().trim().min(1).max(512).describe('Exact semantic context ID.');
const statementsSchema = z
  .array(statementInputSchema)
  .min(1)
  .max(100)
  .describe('One to 100 semantic statements.');
const targetNodeIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .optional()
  .describe('Attach the context to this exact Knowledge node ID.');
const isGlobalSchema = z
  .boolean()
  .optional()
  .describe('Set true to make the context graph-wide instead of node-specific.');
const nameSchema = z.string().trim().min(1).max(1000).optional().describe('Context name.');
const limitSchema = resultLimitSchema.describe(
  'Maximum returned graphs, suggestions, or statements.',
);

const actionParamsSchema = z.discriminatedUnion('action', [
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
  z
    .object({
      action: z.literal('create'),
      graphId: optionalGraphIdSchema,
      statements: statementsSchema,
      targetNodeId: targetNodeIdSchema,
      isGlobal: isGlobalSchema,
      name: nameSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('update'),
      graphId: optionalGraphIdSchema,
      contextId: contextIdSchema,
      statements: statementsSchema.optional(),
      targetNodeId: targetNodeIdSchema,
      isGlobal: isGlobalSchema,
      name: nameSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('delete'),
      graphId: optionalGraphIdSchema,
      contextId: contextIdSchema,
    })
    .strict(),
]);

const paramsSchema = actionParamsSchema.superRefine((args, context) => {
  const message = validateArgs(args);
  if (message) context.addIssue({ code: z.ZodIssueCode.custom, message });
});

export const getManageKnowledgeContextTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'manage-knowledge-context',
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('knowledge-tools')),
    ),
    minRequiredRole: SiteRole.CREATOR,
    registrationConditions: ['RequiresKnowledge'],
    description: `
Inspects and curates customer-governed Tableau Knowledge context through one management entry point.
Use action="status" to discover graphs, "list" to inspect existing semantic context,
"suggestions" to review graph-health recommendations, "create" to add context, and "update" to
revise a context by exact contextId. Use "delete" to delete a customer-managed context by exact
contextId. Create, update, and delete change shared graph state; present the exact proposed change
to the user before invoking them. This tool requires both Knowledge read and write scopes because
its read-before-write workflow spans both capabilities.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Manage Knowledge Context',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
    callback: async (args, extra): Promise<CallToolResult> => {
      const configuredLimit = (await extra.getConfigWithOverrides()).getMaxResultLimit(tool.name);
      const limit = getKnowledgeResultLimit(
        'limit' in args ? args.limit : undefined,
        configuredLimit,
      );

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
                    const returned = graphs.slice(0, limit);
                    return {
                      action: args.action,
                      graphs: returned,
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
                  case 'create': {
                    const context = await methods.createSemanticStatements({
                      graphId: args.graphId,
                      statements: args.statements,
                      targetNodeId: args.targetNodeId,
                      isGlobal: args.isGlobal,
                      name: args.name,
                    });
                    return { action: args.action, context };
                  }
                  case 'update': {
                    const context = await methods.updateSemanticStatements({
                      graphId: args.graphId,
                      contextId: args.contextId,
                      statements: args.statements,
                      targetNodeId: args.targetNodeId,
                      isGlobal: args.isGlobal,
                      name: args.name,
                    });
                    return { action: args.action, context };
                  }
                  case 'delete': {
                    await methods.deleteSemanticStatements({
                      graphId: args.graphId,
                      contextId: args.contextId,
                    });
                    return {
                      action: args.action,
                      contextId: args.contextId,
                      requestCompleted: true,
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

function validateArgs(args: z.infer<typeof actionParamsSchema>): string | null {
  if (args.action === 'create') {
    if (!args.targetNodeId && args.isGlobal !== true) {
      return 'create requires targetNodeId or isGlobal: true.';
    }
    if (args.targetNodeId && args.isGlobal === true) {
      return 'create accepts targetNodeId or isGlobal: true, not both.';
    }
  }

  if (args.action === 'update') {
    if (args.targetNodeId && args.isGlobal === true) {
      return 'update accepts targetNodeId or isGlobal: true, not both.';
    }
    if (
      !args.statements &&
      args.targetNodeId === undefined &&
      args.isGlobal === undefined &&
      args.name === undefined
    ) {
      return 'update requires at least one changed field.';
    }
  }

  return null;
}

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
