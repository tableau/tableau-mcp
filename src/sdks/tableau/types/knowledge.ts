import { z } from 'zod';

export const severitySchema = z.enum(['high', 'medium', 'low']);

export const knowledgeGraphSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  status: z.enum(['active', 'inactive', 'processing', 'failed']),
  is_primary: z.boolean(),
  created_at: z.string().datetime({ offset: true }).nullable(),
  updated_at: z.string().datetime({ offset: true }).nullable(),
});

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
  'SEMANTIC_CONTEXT_EXTERNAL',
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

export const scoredStatementSchema = z.object({
  id: z.string(),
  statement: z.string(),
  score: z.number(),
});

export const knowledgeNodeCandidateSchema = z
  .object({
    id: z.string(),
    type: nodeTypeSchema,
    name: z.string(),
    properties: z.record(z.unknown()),
    score: z.number(),
    certified: z.unknown().optional(),
    semantic_statements: z.array(scoredStatementSchema),
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

// Tableau-managed context: read-only, no is_global/kind/source, carries a category.
const semanticContextExternalSchema = z
  .object({
    id: z.string(),
    type: z.literal('SEMANTIC_CONTEXT_EXTERNAL'),
    name: z.string(),
    properties: z
      .object({
        statements: z.array(storedSemanticStatementSchema),
        source: z.string().optional(),
        updated_at: z.string().datetime({ offset: true }).nullable().optional(),
        category: nullableStringSchema.optional(),
      })
      .passthrough(),
    last_synced_at: z.string().datetime({ offset: true }).nullable().optional(),
    target_node_id: nullableStringSchema.optional(),
  })
  .passthrough();

export const semanticContextNodeSchema = z.discriminatedUnion('type', [
  semanticStatementContextSchema,
  semanticContextExternalSchema,
]);

const connectedNodeWithEdgeSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: nodeTypeSchema,
    edge_type: edgeTypeSchema,
  })
  .passthrough();

export const knowledgeNodeContextSchema = z
  .object({
    id: z.string(),
    type: nodeTypeSchema,
    name: z.string(),
    properties: z.record(z.unknown()),
    semantic_statements: z.array(storedSemanticStatementSchema),
    connected_nodes: z.array(connectedNodeWithEdgeSchema),
  })
  .passthrough();

export const knowledgeNodeSearchResponseSchema = z.object({
  matches: z.array(knowledgeNodeCandidateSchema),
});

export type KnowledgeGraph = z.infer<typeof knowledgeGraphSchema>;
export type KnowledgeSource = z.infer<typeof knowledgeSourcesSchema>[number];
export type KnowledgeSourceNodeType = z.infer<typeof knowledgeSourceNodeTypeSchema>;
export type NodeType = z.infer<typeof nodeTypeSchema>;
export type EdgeType = z.infer<typeof edgeTypeSchema>;
export type KnowledgeNodeSearchResponse = z.infer<typeof knowledgeNodeSearchResponseSchema>;
export type KnowledgeNodeContext = z.infer<typeof knowledgeNodeContextSchema>;
export type KnowledgeNodeRelationships = z.infer<typeof knowledgeNodeRelationshipsSchema>;
export type KnowledgeLineage = z.infer<typeof knowledgeLineageSchema>;
export type KnowledgeNodeImpact = z.infer<typeof knowledgeNodeImpactSchema>;
export type SemanticStatementInput = z.infer<typeof semanticStatementInputSchema>;
export type SemanticStatementContext = z.infer<typeof semanticStatementContextSchema>;
export type SemanticContextNode = z.infer<typeof semanticContextNodeSchema>;
export type SuggestionReport = z.infer<typeof suggestionReportSchema>;
export type SuggestionSeverity = z.infer<typeof severitySchema>;
