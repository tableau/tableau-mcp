import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
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

// A flat raw shape, not a z.discriminatedUnion. The MCP SDK's normalizeObjectSchema needs a
// top-level `.shape` to advertise a real inputSchema; a discriminated union has none, so the SDK
// falls back to advertising `{"type":"object","properties":{}}` and agents guess at arguments.
// See validateInspectArgs below for the per-action field allowlist this flat shape can no longer
// express structurally.
const actionSchema = z
  .enum(['status', 'list', 'suggestions'])
  .describe(
    'What to inspect. "status": limit only. "list": graphId, nodeId, isGlobal, limit. ' +
      '"suggestions": graphId, pdsId, severity, suggestionType, limit.',
  );

const paramsSchema = {
  action: actionSchema,
  graphId: optionalGraphIdSchema,
  nodeId: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional()
    .describe('Exact Knowledge node ID. (action=list only.)'),
  isGlobal: z.boolean().optional().describe('Filter by graph-wide status. (action=list only.)'),
  pdsId: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional()
    .describe('Published data source ID. (action=suggestions only.)'),
  severity: severitySchema
    .optional()
    .describe('Suggestion severity filter. (action=suggestions only.)'),
  suggestionType: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Suggestion type filter. (action=suggestions only.)'),
  limit: limitSchema,
};

// Type-only helper: gives validateInspectArgs a precise parameter type. This object schema is
// never registered with the MCP server or used to parse anything — `paramsSchema` above (the flat
// raw shape) is what the SDK advertises and parses against.
type InspectArgs = z.infer<z.ZodObject<typeof paramsSchema>>;

const FIELDS_BY_ACTION: Record<InspectArgs['action'], ReadonlyArray<keyof InspectArgs>> = {
  status: [],
  list: ['graphId', 'nodeId', 'isGlobal'],
  suggestions: ['graphId', 'pdsId', 'severity', 'suggestionType'],
};

/**
 * Pure per-action validation that the flat schema can no longer express structurally: which
 * params are allowed for the chosen action. `limit` is always allowed. Returns a clear,
 * actionable message on failure, or null when args are valid.
 */
export function validateInspectArgs(args: InspectArgs): string | null {
  const allowed = new Set<keyof InspectArgs>(['action', 'limit', ...FIELDS_BY_ACTION[args.action]]);
  const disallowed = (Object.keys(args) as Array<keyof InspectArgs>).filter(
    (key) => args[key] !== undefined && !allowed.has(key),
  );
  if (disallowed.length > 0) {
    return `${disallowed.join(', ')} ${disallowed.length === 1 ? 'is' : 'are'} not used when action is "${args.action}".`;
  }

  return null;
}

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
          // Surfaced from inside logAndExecute (not a pre-callback early return) so the invocation
          // is still logged and telemetry-emitted even when the args are rejected.
          const validationError = validateInspectArgs(args);
          if (validationError) {
            return new ArgsValidationError(validationError).toErr();
          }

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
