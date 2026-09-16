import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import { severitySchema } from '../../../sdks/tableau/apis/knowledgeApi.js';
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

const actionSchema = z.enum(['status', 'list', 'suggestions', 'create', 'update', 'delete']);
const statementInputSchema = z.object({
  statement: z.string().trim().min(1).max(10000),
  id: z.string().trim().min(1).max(512).nullable().optional(),
});

const paramsSchema = {
  action: actionSchema.describe(
    'Management operation: inspect graph status, list contexts, review suggestions, create, update, or delete context.',
  ),
  graphId: graphIdSchema
    .optional()
    .describe("Knowledge graph ID. Omit to use the site's primary graph."),
  nodeId: z.string().trim().min(1).max(512).optional(),
  isGlobal: z.boolean().optional(),
  pdsId: z.string().trim().min(1).max(512).optional(),
  severity: severitySchema.optional(),
  suggestionType: z.string().trim().min(1).max(200).optional(),
  contextId: z.string().trim().min(1).max(512).optional(),
  statements: z.array(statementInputSchema).min(1).max(100).optional(),
  targetNodeId: z.string().trim().min(1).max(512).optional(),
  name: z.string().trim().min(1).max(1000).optional(),
  limit: resultLimitSchema.describe('Maximum returned graphs, suggestions, or statements.'),
};

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
      const limit = getKnowledgeResultLimit(args.limit, configuredLimit);

      return await tool.logAndExecute({
        extra,
        args,
        callback: async () => {
          const validationError = validateArgs(args);
          if (validationError) return new ArgsValidationError(validationError).toErr();

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
                      statements: args.statements!,
                      targetNodeId: args.targetNodeId,
                      isGlobal: args.isGlobal,
                      name: args.name,
                    });
                    return { action: args.action, context };
                  }
                  case 'update': {
                    const context = await methods.updateSemanticStatements({
                      graphId: args.graphId,
                      contextId: args.contextId!,
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
                      contextId: args.contextId!,
                    });
                    return {
                      action: args.action,
                      contextId: args.contextId!,
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

function validateArgs(args: {
  action: z.infer<typeof actionSchema>;
  contextId?: string;
  statements?: z.infer<typeof statementInputSchema>[];
  targetNodeId?: string;
  isGlobal?: boolean;
  name?: string;
}): string | null {
  if (args.action === 'create') {
    if (!args.statements?.length) return 'statements is required when action is "create".';
    if (!args.targetNodeId && args.isGlobal !== true) {
      return 'create requires targetNodeId or isGlobal: true.';
    }
    if (args.targetNodeId && args.isGlobal === true) {
      return 'create accepts targetNodeId or isGlobal: true, not both.';
    }
  }

  if (args.action === 'update' || args.action === 'delete') {
    if (!args.contextId) return `contextId is required when action is "${args.action}".`;
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
