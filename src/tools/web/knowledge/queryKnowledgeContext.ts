import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { ArgsValidationError } from '../../../errors/mcpToolError.js';
import { getFeatureGate } from '../../../features/init.js';
import { useRestApi } from '../../../restApiInstance.js';
import {
  edgeTypeSchema,
  KnowledgeNodeContext,
  nodeTypeSchema,
  SemanticContextNode,
} from '../../../sdks/tableau/apis/knowledgeApi.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import { getHttpStatus } from '../../../utils/getHttpStatus.js';
import { Provider } from '../../../utils/provider.js';
import { WebTool } from '../tool.js';
import {
  flattenKnowledgeStatements,
  getKnowledgeResultLimit,
  graphIdSchema,
  isGlobalKnowledgeContext,
  resultLimitSchema,
} from './knowledgeToolUtils.js';

const intentSchema = z.enum(['ground', 'relationships', 'lineage', 'impact', 'sources']);

const paramsSchema = {
  intent: intentSchema.describe(
    'Operation to perform: ground curated context, inspect relationships, trace lineage, assess impact, or list graph sources.',
  ),
  graphId: graphIdSchema
    .optional()
    .describe("Knowledge graph ID. Omit to use the site's primary graph."),
  query: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .optional()
    .describe('Natural-language node search. Returns candidates; it never chooses a node for you.'),
  nodeId: z
    .string()
    .trim()
    .min(1)
    .max(512)
    .optional()
    .describe('Exact node ID selected from a prior candidate response.'),
  nodeType: nodeTypeSchema.optional().describe('Optional node type filter for search or sources.'),
  includeGlobal: z
    .boolean()
    .optional()
    .describe('Include graph-wide customer-governed context while grounding. Defaults to true.'),
  edgeType: edgeTypeSchema
    .optional()
    .describe('Optional relationship type. Use with direction to narrow truncated results.'),
  direction: z
    .enum(['outgoing', 'incoming'])
    .optional()
    .describe('Optional relationship direction. Use with edgeType to narrow truncated results.'),
  threshold: z.number().min(0).max(1).optional(),
  limit: resultLimitSchema.describe('Maximum returned candidates, statements, or traversal rows.'),
};

type QueryWarning = {
  type: 'ENTITY_UNAVAILABLE' | 'ATTACHED_CONTEXT_UNAVAILABLE' | 'GLOBAL_CONTEXT_UNAVAILABLE';
  severity: 'WARNING';
  httpStatus?: string;
};

export const getQueryKnowledgeContextTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const tool = new WebTool({
    server,
    name: 'query-knowledge-context',
    disabled: new Provider(
      async () => !(await getFeatureGate().isFeatureEnabled('knowledge-tools')),
    ),
    minRequiredRole: SiteRole.VIEWER,
    registrationConditions: ['RequiresKnowledge'],
    description: `
Queries Tableau Knowledge through one read-only entry point. Use intent="ground" for governed
definitions and business rules, "relationships" for neighboring nodes, "lineage" for upstream and
downstream structure, "impact" for affected assets, and "sources" for graph inventory.

For node-based intents, pass either query or nodeId. A query returns ranked candidates only; the tool
does not auto-select a match because Knowledge scores are not calibrated for safe entity resolution.
Choose a candidate and call again with its exact nodeId. Grounded statements carry viewGated: true
when their visibility follows a Tableau source's VIEW permission and false for customer-authored
graph context governed by site access. An empty attached result is reported as unknown, never proof
that no attached context exists. Inspect mcp warnings and resultInfo before claiming completeness.
If relationships are truncated, rerun with edgeType and direction before reporting a complete list.
`.trim(),
    paramsSchema,
    annotations: {
      title: 'Query Knowledge Context',
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
          if (args.intent !== 'sources' && !args.nodeId && !args.query) {
            return new ArgsValidationError(
              `query or nodeId is required when intent is "${args.intent}".`,
            ).toErr();
          }

          return new Ok(
            await useRestApi({
              ...extra,
              jwtScopes: tool.requiredApiScopes,
              callback: async (restApi) => {
                const methods = restApi.knowledgeMethods;

                if (args.intent !== 'sources' && !args.nodeId) {
                  const { matches } = await methods.searchKnowledgeNodes({
                    graphId: args.graphId,
                    query: args.query!,
                    nodeType: args.nodeType,
                    limit,
                    threshold: args.threshold,
                  });
                  const candidates = matches
                    .slice(0, limit)
                    .map(({ id, name, type, score }) => ({ id, name, type, score }));
                  return {
                    intent: args.intent,
                    query: args.query,
                    resolution: candidates.length === 0 ? 'no_match' : 'candidates',
                    requiresNodeId: candidates.length > 0,
                    nameCollision: hasNameCollision(candidates),
                    candidates,
                    mcp: {
                      resultInfo: {
                        returnedCandidateCount: candidates.length,
                        truncated: matches.length > limit,
                        completeness: 'unknown',
                      },
                    },
                  };
                }

                switch (args.intent) {
                  case 'ground':
                    return await groundNode({
                      methods,
                      graphId: args.graphId,
                      nodeId: args.nodeId!,
                      includeGlobal: args.includeGlobal ?? true,
                      rankTerm: args.query,
                      limit,
                    });
                  case 'relationships': {
                    const result = await methods.getKnowledgeNodeRelationships({
                      graphId: args.graphId,
                      nodeId: args.nodeId,
                      edgeType: args.edgeType,
                      direction: args.direction,
                    });
                    return {
                      intent: args.intent,
                      ...result,
                      edges: result.edges.slice(0, limit),
                      mcp: { resultInfo: arrayResultInfo('Edge', result.edges.length, limit) },
                    };
                  }
                  case 'lineage': {
                    const result = await methods.getKnowledgeLineage({
                      graphId: args.graphId,
                      nodeId: args.nodeId!,
                    });
                    return {
                      intent: args.intent,
                      nodeId: args.nodeId,
                      nodes: result.nodes.slice(0, limit),
                      edges: result.edges.slice(0, limit),
                      mcp: {
                        resultInfo: {
                          originalNodeCount: result.nodes.length,
                          returnedNodeCount: Math.min(result.nodes.length, limit),
                          originalEdgeCount: result.edges.length,
                          returnedEdgeCount: Math.min(result.edges.length, limit),
                          truncated: result.nodes.length > limit || result.edges.length > limit,
                        },
                      },
                    };
                  }
                  case 'impact': {
                    const result = await methods.getKnowledgeNodeImpact({
                      graphId: args.graphId,
                      nodeId: args.nodeId!,
                    });
                    return {
                      intent: args.intent,
                      ...result,
                      affected_assets: result.affected_assets.slice(0, limit),
                      mcp: {
                        resultInfo: arrayResultInfo(
                          'AffectedAsset',
                          result.affected_assets.length,
                          limit,
                        ),
                      },
                    };
                  }
                  case 'sources': {
                    const sources = await methods.listKnowledgeSources({
                      graphId: args.graphId,
                      nodeType: args.nodeType,
                    });
                    return {
                      intent: args.intent,
                      sources: sources.slice(0, limit),
                      mcp: { resultInfo: arrayResultInfo('Source', sources.length, limit) },
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

async function groundNode({
  methods,
  graphId,
  nodeId,
  includeGlobal,
  rankTerm,
  limit,
}: {
  methods: {
    getKnowledgeNode: (args: {
      graphId?: string;
      nodeId: string;
      includeChildren?: boolean;
    }) => Promise<KnowledgeNodeContext>;
    listSemanticStatements: (args: {
      graphId?: string;
      nodeId?: string;
      isGlobal?: boolean;
    }) => Promise<SemanticContextNode[]>;
  };
  graphId?: string;
  nodeId: string;
  includeGlobal: boolean;
  rankTerm?: string;
  limit: number;
}): Promise<Record<string, unknown>> {
  const [entityResult, attachedResult, globalResult] = await Promise.allSettled([
    methods.getKnowledgeNode({ graphId, nodeId, includeChildren: false }),
    methods.listSemanticStatements({ graphId, nodeId }),
    includeGlobal
      ? methods.listSemanticStatements({ graphId, isGlobal: true })
      : Promise.resolve(null),
  ] as const);

  if (
    entityResult.status === 'rejected' &&
    attachedResult.status === 'rejected' &&
    (!includeGlobal || globalResult.status === 'rejected')
  ) {
    throw entityResult.reason;
  }

  const warnings: QueryWarning[] = [];
  const entity =
    entityResult.status === 'fulfilled'
      ? slimEntity(entityResult.value)
      : (warnings.push(warning('ENTITY_UNAVAILABLE', entityResult.reason)), null);

  const attached =
    attachedResult.status === 'fulfilled'
      ? flattenKnowledgeStatements({
          contexts: attachedResult.value.filter((context) => !isGlobalKnowledgeContext(context)),
          scope: 'attached',
          limit,
        })
      : null;
  if (attachedResult.status === 'rejected') {
    warnings.push(warning('ATTACHED_CONTEXT_UNAVAILABLE', attachedResult.reason));
  }

  let global: ReturnType<typeof flattenKnowledgeStatements> | null = null;
  if (includeGlobal && globalResult.status === 'fulfilled') {
    global = flattenKnowledgeStatements({
      contexts: globalResult.value!,
      scope: 'global',
      limit,
      rankTerm: rankTerm ?? entity?.name ?? nodeId,
    });
  } else if (includeGlobal && globalResult.status === 'rejected') {
    warnings.push(warning('GLOBAL_CONTEXT_UNAVAILABLE', globalResult.reason));
  }

  return {
    intent: 'ground' as const,
    resolution: 'provided' as const,
    nodeId,
    entity,
    attached: attached
      ? {
          status: attached.statements.length > 0 ? ('available' as const) : ('unknown' as const),
          ...attached,
        }
      : { status: 'unavailable' as const, statements: [] },
    global: !includeGlobal
      ? { status: 'omitted' as const, statements: [] }
      : global
        ? {
            status: global.statements.length > 0 ? ('available' as const) : ('empty' as const),
            ...global,
          }
        : { status: 'unavailable' as const, statements: [] },
    groundingStatus: warnings.length === 0 ? ('complete' as const) : ('partial' as const),
    ...(warnings.length > 0 ? { mcp: { warnings } } : {}),
  };
}

function slimEntity(node: KnowledgeNodeContext): { id: string; name: string; type: string } {
  return { id: node.id, name: node.name, type: node.type };
}

function warning(type: QueryWarning['type'], error: unknown): QueryWarning {
  const httpStatus = getHttpStatus(error as Error);
  return { type, severity: 'WARNING', ...(httpStatus ? { httpStatus } : {}) };
}

function hasNameCollision(candidates: Array<{ name: string; type: string }>): boolean {
  const seen = new Set<string>();
  return candidates.some((candidate) => {
    const key = `${candidate.type}\u0000${candidate.name}`;
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}

function arrayResultInfo(
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
