import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

const severitySchema = z.enum(['high', 'medium', 'low']);

const suggestionSchema = z.object({
  id: z.string(),
  type: z.string(),
  category: z.string(),
  topic: z.string(),
  title: z.string(),
  detail: z.string(),
  recommended_action: z.string(),
  severity: severitySchema,
  target_ids: z.array(z.string()),
  metadata: z.record(z.unknown()),
});

const categoryGroupSchema = z.object({
  category: z.string(),
  count: z.number().int(),
  severity: severitySchema,
  suggestions: z.array(suggestionSchema),
});

export const suggestionReportSchema = z.object({
  health_score: z.number().int().nullable().optional(),
  stats: z.object({
    total_nodes: z.number().int(),
    total_relationships: z.number().int(),
    connected_sources: z.number().int(),
    workbooks: z.number().int(),
    context_coverage: z.number().nullable().optional(),
  }),
  metrics: z.array(
    z.object({
      category: z.string(),
      label: z.string(),
      total: z.number().int(),
      passing: z.number().int(),
      coverage: z.number().nullable().optional(),
    }),
  ),
  suggestions: z.array(suggestionSchema),
  categories: z.array(categoryGroupSchema),
  topics: z.array(
    z.object({
      topic: z.string(),
      count: z.number().int(),
      severity: severitySchema,
      categories: z.array(categoryGroupSchema),
    }),
  ),
  summary: z.object({
    total: z.number().int(),
    by_severity: z.record(z.number().int()),
    by_type: z.record(z.number().int()),
    by_category: z.record(z.number().int()),
    by_topic: z.record(z.number().int()),
    errors: z.number().int(),
  }),
  errors: z.array(z.object({ type: z.string(), message: z.string() })),
});

export const nodeTypeSchema = z.enum([
  'CONNECTION',
  'SITE',
  'PDS',
  'TABLE',
  'FIELD',
  'WORKBOOK',
  'SHEET',
  'DASHBOARD',
  'EMBEDDED_DATASOURCE',
  'SCHEMA',
  'WAREHOUSE_TABLE',
  'WAREHOUSE_COLUMN',
  'SEMANTIC_CONTEXT',
]);

export const edgeTypeSchema = z.enum([
  'CONTAINS',
  'HAS',
  'JOINS',
  'DEPENDS_ON',
  'LINEAGE',
  'SEMANTIC_EQUIV',
  'DESCRIBES',
]);

export const knowledgeSourceNodeTypeSchema = z.string();

export const knowledgeSourcesSchema = z.array(
  z
    .object({
      id: z.string(),
      type: nodeTypeSchema,
      name: z.string(),
      properties: z.record(z.unknown()),
      last_synced_at: z.string().nullable().optional(),
    })
    .passthrough(),
);

const nullableStringSchema = z.string().nullable();

export const knowledgeNodeCandidateSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: nodeTypeSchema,
    score: z.number(),
    certified: z.unknown().optional(),
    statements: z
      .array(z.object({ id: z.string(), statement: z.string() }))
      .nullable()
      .optional(),
  })
  .passthrough();

export const knowledgeNodeSchema = z
  .object({
    id: z.string(),
    type: nodeTypeSchema,
    name: z.string(),
    properties: z.record(z.unknown()),
    sync_status: z.string().optional(),
    last_synced_at: nullableStringSchema.optional(),
  })
  .passthrough();

export const knowledgeEdgeSchema = z
  .object({
    id: z.string(),
    type: edgeTypeSchema,
    source_id: z.string(),
    target_id: z.string(),
    properties: z.record(z.unknown()),
    connected_node: z
      .object({ id: z.string(), name: nullableStringSchema, type: nodeTypeSchema.nullable() })
      .optional(),
  })
  .passthrough();

export const knowledgeNodeRelationshipsSchema = z.object({
  node_id: z.string(),
  name: z.string(),
  edges: z.array(
    knowledgeEdgeSchema.extend({
      direction: z.enum(['outgoing', 'incoming']),
      connected_node: z.object({
        id: z.string(),
        name: nullableStringSchema,
        type: nodeTypeSchema.nullable(),
      }),
    }),
  ),
});

export const knowledgeLineageSchema = z.object({
  nodes: z.array(knowledgeNodeSchema),
  edges: z.array(knowledgeEdgeSchema),
});

export const knowledgeNodeImpactSchema = z.object({
  node_id: z.string(),
  affected_assets: z.array(knowledgeNodeSchema),
});

export const semanticStatementInputSchema = z.object({
  statement: z.string(),
  id: z.string().nullable().optional(),
});

export const storedSemanticStatementSchema = z.object({
  id: z.string(),
  statement: z.string(),
});

export const semanticStatementContextSchema = z
  .object({
    id: z.string(),
    type: z.literal('SEMANTIC_CONTEXT'),
    name: z.string(),
    properties: z
      .object({
        statements: z.array(storedSemanticStatementSchema),
        is_global: z.boolean(),
        kind: z.string(),
        source: z.string(),
        updated_by: nullableStringSchema.optional(),
        updated_at: z.string().datetime({ offset: true }),
        filename: nullableStringSchema.optional(),
      })
      .passthrough(),
    last_synced_at: z.string().datetime({ offset: true }).nullable().optional(),
    target_node_id: nullableStringSchema.optional(),
  })
  .passthrough();

const createSemanticStatementsBodySchema = z.object({
  statements: z.array(semanticStatementInputSchema),
  target_node_id: nullableStringSchema.optional(),
  is_global: z.boolean().nullable().optional(),
  name: nullableStringSchema.optional(),
});
const updateSemanticStatementsBodySchema = createSemanticStatementsBodySchema
  .omit({ statements: true })
  .extend({ statements: z.array(semanticStatementInputSchema).nullable().optional() });

const knowledgeNodeDetailSchema = knowledgeNodeSchema.and(
  z
    .object({
      score: z.number(),
    })
    .passthrough(),
);

export const knowledgeNodeSearchResponseSchema = z.object({
  matches: z.array(knowledgeNodeCandidateSchema),
});

export const knowledgeNodeResolveResponseSchema = z.discriminatedUnion('needs_disambiguation', [
  z.object({
    needs_disambiguation: z.literal(false),
    node: knowledgeNodeDetailSchema,
  }),
  z.object({
    needs_disambiguation: z.literal(true),
    node: z.null(),
    candidates: z.array(knowledgeNodeCandidateSchema),
  }),
]);

const searchSuggestionsEndpoint = makeEndpoint({
  method: 'post',
  path: '/suggestions/search',
  alias: 'searchSuggestions',
  description: 'Returns a graph-health suggestions report.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    {
      name: 'body',
      type: 'Body',
      schema: z.object({
        pds_id: z.string().nullable().optional(),
        severity: severitySchema.nullable().optional(),
        type: z.string().nullable().optional(),
        limit: z.number().int().nullable().optional(),
      }),
    },
  ],
  response: suggestionReportSchema,
});

const searchSourcesEndpoint = makeEndpoint({
  method: 'post',
  path: '/sources/search',
  alias: 'searchSources',
  description: 'Returns published data sources and workbooks in a knowledge graph.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    {
      name: 'body',
      type: 'Body',
      schema: z.object({ node_type: knowledgeSourceNodeTypeSchema.nullable().optional() }),
    },
  ],
  response: knowledgeSourcesSchema,
});

const searchNodesEndpoint = makeEndpoint({
  method: 'post',
  path: '/nodes/search',
  alias: 'searchNodes',
  description: 'Semantically searches nodes in a knowledge graph.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    {
      name: 'body',
      type: 'Body',
      schema: z.object({
        query: z.string(),
        node_type: nullableStringSchema.optional(),
        scope_id: nullableStringSchema.optional(),
        limit: z.number().int().nullable().optional(),
      }),
    },
  ],
  response: knowledgeNodeSearchResponseSchema,
});

const resolveNodeEndpoint = makeEndpoint({
  method: 'post',
  path: '/nodes/resolve',
  alias: 'resolveNode',
  description: 'Resolves a natural-language query to one knowledge node or candidates.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    {
      name: 'body',
      type: 'Body',
      schema: z.object({
        query: z.string(),
        node_type: nullableStringSchema.optional(),
        scope_id: nullableStringSchema.optional(),
        max_candidates: z.number().int().nullable().optional(),
      }),
    },
  ],
  response: knowledgeNodeResolveResponseSchema,
});

const searchNodeRelationshipsEndpoint = makeEndpoint({
  method: 'post',
  path: '/edges/search',
  alias: 'searchNodeRelationships',
  description: 'Returns relationships around one knowledge node.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    {
      name: 'body',
      type: 'Body',
      schema: z.object({
        node_id: nullableStringSchema.optional(),
        query: nullableStringSchema.optional(),
        edge_type: nullableStringSchema.optional(),
        direction: z.enum(['outgoing', 'incoming']).nullable().optional(),
      }),
    },
  ],
  response: knowledgeNodeRelationshipsSchema,
});

const getLineageEndpoint = makeEndpoint({
  method: 'get',
  path: '/lineage/:node_id',
  alias: 'getLineage',
  description: 'Returns lineage around one knowledge node.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    { name: 'node_id', type: 'Path', schema: z.string() },
  ],
  response: knowledgeLineageSchema,
});

const getNodeImpactEndpoint = makeEndpoint({
  method: 'get',
  path: '/nodes/:node_id/impact',
  alias: 'getNodeImpact',
  description: 'Returns assets transitively affected by one knowledge node.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    { name: 'node_id', type: 'Path', schema: z.string() },
  ],
  response: knowledgeNodeImpactSchema,
});

const createSemanticStatementsEndpoint = makeEndpoint({
  method: 'post',
  path: '/semantic-statements',
  alias: 'createSemanticStatements',
  description: 'Creates semantic statements in a knowledge graph.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    { name: 'body', type: 'Body', schema: createSemanticStatementsBodySchema },
  ],
  response: semanticStatementContextSchema,
});

const listSemanticStatementsEndpoint = makeEndpoint({
  method: 'post',
  path: '/semantic-statements/search',
  alias: 'listSemanticStatements',
  description: 'Lists semantic statements in a knowledge graph.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    {
      name: 'body',
      type: 'Body',
      schema: z.object({ is_global: z.boolean().nullable().optional() }),
    },
  ],
  response: z.array(semanticStatementContextSchema),
});

const listNodeSemanticStatementsEndpoint = makeEndpoint({
  method: 'post',
  path: '/nodes/:node_id/semantic-statements/search',
  alias: 'listNodeSemanticStatements',
  description: 'Lists attached and global semantic statements for a knowledge node.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    { name: 'node_id', type: 'Path', schema: z.string() },
    { name: 'body', type: 'Body', schema: z.object({}) },
  ],
  response: z.array(semanticStatementContextSchema),
});

const updateSemanticStatementsEndpoint = makeEndpoint({
  method: 'patch',
  path: '/semantic-statements/:ctx_id',
  alias: 'updateSemanticStatements',
  description: 'Updates semantic statements or their attachment.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    { name: 'ctx_id', type: 'Path', schema: z.string() },
    { name: 'body', type: 'Body', schema: updateSemanticStatementsBodySchema },
  ],
  response: semanticStatementContextSchema,
});

const knowledgeApi = makeApi([
  searchSuggestionsEndpoint,
  searchSourcesEndpoint,
  searchNodesEndpoint,
  resolveNodeEndpoint,
  searchNodeRelationshipsEndpoint,
  getLineageEndpoint,
  getNodeImpactEndpoint,
  createSemanticStatementsEndpoint,
  listSemanticStatementsEndpoint,
  listNodeSemanticStatementsEndpoint,
  updateSemanticStatementsEndpoint,
]);
export const knowledgeApis = [...knowledgeApi] as const satisfies ZodiosEndpointDefinitions;
export type KnowledgeSource = z.infer<typeof knowledgeSourcesSchema>[number];
export type KnowledgeSourceNodeType = z.infer<typeof knowledgeSourceNodeTypeSchema>;
export type NodeType = z.infer<typeof nodeTypeSchema>;
export type EdgeType = z.infer<typeof edgeTypeSchema>;
export type KnowledgeNodeSearchResponse = z.infer<typeof knowledgeNodeSearchResponseSchema>;
export type KnowledgeNodeResolveResponse = z.infer<typeof knowledgeNodeResolveResponseSchema>;
export type KnowledgeNodeRelationships = z.infer<typeof knowledgeNodeRelationshipsSchema>;
export type KnowledgeLineage = z.infer<typeof knowledgeLineageSchema>;
export type KnowledgeNodeImpact = z.infer<typeof knowledgeNodeImpactSchema>;
export type SemanticStatementInput = z.infer<typeof semanticStatementInputSchema>;
export type SemanticStatementContext = z.infer<typeof semanticStatementContextSchema>;
export type SuggestionReport = z.infer<typeof suggestionReportSchema>;
export type SuggestionSeverity = z.infer<typeof severitySchema>;
