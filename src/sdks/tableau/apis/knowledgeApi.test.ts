import { describe, expect, it } from 'vitest';
import { ZodTypeAny } from 'zod';

import * as knowledgeApi from './knowledgeApi.js';

const {
  edgeTypeSchema,
  knowledgeApis,
  knowledgeNodeCandidateSchema,
  knowledgeSourcesSchema,
  nodeTypeSchema,
  suggestionReportSchema,
} = knowledgeApi;

const bodySchema = (alias: string): ZodTypeAny =>
  knowledgeApis
    .find((endpoint) => endpoint.alias === alias)!
    .parameters.find((parameter) => parameter.type === 'Body')!.schema;

const nodeTypes = [
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
] as const;

const edgeTypes = [
  'CONTAINS',
  'HAS',
  'JOINS',
  'DEPENDS_ON',
  'LINEAGE',
  'SEMANTIC_EQUIV',
  'DESCRIBES',
] as const;

const suggestion = {
  id: 'suggestion-1',
  type: 'missing-description',
  category: 'metadata',
  topic: 'Metadata Insights',
  title: 'Add a description',
  detail: 'The field has no description.',
  recommended_action: 'Document the field.',
  severity: 'high',
  target_ids: ['field-1'],
  metadata: { field_name: 'Revenue' },
};

const report = {
  health_score: 75,
  stats: {
    total_nodes: 10,
    total_relationships: 7,
    connected_sources: 2,
    workbooks: 1,
    context_coverage: 0.6,
  },
  metrics: [{ category: 'metadata', label: 'Descriptions', total: 4, passing: 3, coverage: 0.75 }],
  suggestions: [suggestion],
  categories: [{ category: 'metadata', count: 1, severity: 'high', suggestions: [suggestion] }],
  topics: [
    {
      topic: 'Metadata Insights',
      count: 1,
      severity: 'high',
      categories: [{ category: 'metadata', count: 1, severity: 'high', suggestions: [suggestion] }],
    },
  ],
  summary: {
    total: 1,
    by_severity: { high: 1 },
    by_type: { 'missing-description': 1 },
    by_category: { metadata: 1 },
    by_topic: { 'Metadata Insights': 1 },
    errors: 1,
  },
  errors: [{ type: 'rule-failure', message: 'One rule could not run.' }],
};

describe('suggestionReportSchema', () => {
  it('parses a complete SuggestionReport without dropping transitive fields', () => {
    expect(suggestionReportSchema.parse(report)).toEqual(report);
  });

  it.each(['stats', 'metrics', 'suggestions', 'categories', 'topics', 'summary', 'errors'])(
    'rejects a report missing required %s',
    (field) => {
      const malformed = { ...report };
      delete malformed[field as keyof typeof malformed];
      expect(suggestionReportSchema.safeParse(malformed).success).toBe(false);
    },
  );
});

describe('knowledgeSourcesSchema', () => {
  const sources = [
    {
      id: 'pds-1',
      type: 'PDS',
      name: 'Sales Data',
      properties: { connection_type: 'snowflake', nested: { certified: true } },
      sync_status: 'idle',
      last_synced_at: null,
    },
    {
      id: 'workbook-1',
      type: 'WORKBOOK',
      name: 'Executive Overview',
      properties: { project_id: 'project-1', sheets: 4 },
      sync_status: 'syncing',
      last_synced_at: '2026-08-12T15:04:05Z',
    },
  ];

  it('preserves complete PDS and WORKBOOK nodes including runtime metadata', () => {
    expect(knowledgeSourcesSchema.parse(sources)).toEqual(sources);
  });

  it.each(['id', 'type', 'name', 'properties'])('rejects a source missing required %s', (field) => {
    const malformed = { ...sources[0] };
    delete malformed[field as keyof typeof malformed];
    expect(knowledgeSourcesSchema.safeParse([malformed]).success).toBe(false);
  });

  it('accepts sources without runtime-only synchronization metadata', () => {
    expect(
      knowledgeSourcesSchema.parse([
        { id: 'pds-1', type: 'PDS', name: 'Sales Data', properties: {} },
      ]),
    ).toEqual([{ id: 'pds-1', type: 'PDS', name: 'Sales Data', properties: {} }]);
  });

  it('uses the full contract NodeType while preserving runtime metadata', () => {
    const source = {
      id: 'table-1',
      type: 'TABLE',
      name: 'Orders',
      properties: {},
      runtime_metadata: { indexed: true },
    };
    expect(knowledgeSourcesSchema.parse([source])).toEqual([source]);
  });
});

describe('knowledge graph enums', () => {
  it.each(nodeTypes)('parses NodeType %s', (type) => {
    expect(nodeTypeSchema.parse(type)).toBe(type);
  });

  it.each(edgeTypes)('parses EdgeType %s', (type) => {
    expect(edgeTypeSchema.parse(type)).toBe(type);
  });

  it('rejects response node and edge types outside the contract', () => {
    expect(nodeTypeSchema.safeParse('CUSTOM_NODE_TYPE').success).toBe(false);
    expect(edgeTypeSchema.safeParse('CUSTOM_EDGE').success).toBe(false);
  });
});

describe('knowledge node endpoints', () => {
  const searchResponse = {
    matches: [
      {
        id: 'context-1',
        name: 'Revenue definition',
        type: 'SEMANTIC_CONTEXT',
        score: 0.91,
        certified: null,
        statements: [{ id: 'stmt-1', statement: 'Revenue excludes tax.' }],
      },
      {
        id: 'field-1',
        name: 'Net Revenue',
        type: 'FIELD',
        score: 0.91,
        certified: true,
      },
    ],
  };

  const fullNode = {
    id: 'field-1',
    type: 'FIELD',
    name: 'Net Revenue',
    properties: { formula: '[Sales] - [Tax]' },
    score: 0.93,
  };

  it('registers search and resolve POST endpoints with the backend paths', () => {
    expect(knowledgeApis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: 'searchNodes',
          method: 'post',
          path: '/nodes/search',
        }),
        expect.objectContaining({
          alias: 'resolveNode',
          method: 'post',
          path: '/nodes/resolve',
        }),
      ]),
    );
  });

  it('exposes graph_id as an optional query param on every knowledge endpoint', () => {
    for (const endpoint of knowledgeApis) {
      const graphIdParam = endpoint.parameters?.find((p) => p.name === 'graph_id');
      expect(graphIdParam, `${endpoint.alias} is missing graph_id`).toBeDefined();
      expect(graphIdParam!.type).toBe('Query');
      // Optional: an omitted graph_id targets the site's active graph server-side.
      expect(graphIdParam!.schema.isOptional()).toBe(true);
      expect(endpoint.path).not.toContain(':graph_id');
    }
  });

  it('parses ranked matches with optional semantic-context statements', () => {
    const schema = (knowledgeApi as any).knowledgeNodeSearchResponseSchema;
    expect(schema).toBeDefined();
    expect(schema.parse(searchResponse)).toEqual(searchResponse);
  });

  it('parses a candidate with explicitly null statements', () => {
    const candidate = { ...searchResponse.matches[1], statements: null };
    expect(knowledgeNodeCandidateSchema.parse(candidate)).toEqual(candidate);
  });

  it('parses the confident full-node resolve branch', () => {
    const response = {
      needs_disambiguation: false,
      node: fullNode,
    };
    const schema = (knowledgeApi as any).knowledgeNodeResolveResponseSchema;
    expect(schema).toBeDefined();
    expect(schema.parse(response)).toEqual(response);
  });

  it('parses sparse candidates in the disambiguation branch', () => {
    const response = {
      needs_disambiguation: true,
      node: null,
      candidates: [
        {
          id: 'field-1',
          name: 'Net Revenue',
          type: 'FIELD',
          score: 0.51,
          certified: null,
        },
      ],
    };
    const schema = (knowledgeApi as any).knowledgeNodeResolveResponseSchema;
    expect(schema).toBeDefined();
    expect(schema.parse(response)).toEqual(response);
  });
});

describe('knowledge traversal endpoints', () => {
  it('registers relationship, lineage, and impact routes with exact backend paths', () => {
    expect(knowledgeApis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: 'searchNodeRelationships',
          method: 'post',
          path: '/edges/search',
        }),
        expect.objectContaining({
          alias: 'getLineage',
          method: 'get',
          path: '/lineage/:node_id',
        }),
        expect.objectContaining({
          alias: 'getNodeImpact',
          method: 'get',
          path: '/nodes/:node_id/impact',
        }),
      ]),
    );
  });

  it('preserves contract relationship types and nullable connected nodes', () => {
    const response = {
      node_id: 'field:Sales',
      name: 'Sales',
      edges: [
        {
          id: 'edge-1',
          type: 'DEPENDS_ON',
          source_id: 'field:Sales',
          target_id: 'missing',
          properties: { confidence: 0.5 },
          direction: 'outgoing',
          connected_node: { id: 'missing', name: null, type: null },
        },
      ],
    };
    expect((knowledgeApi as any).knowledgeNodeRelationshipsSchema.parse(response)).toEqual(
      response,
    );
  });

  it('parses lineage including the successful missing-node empty response', () => {
    const schema = (knowledgeApi as any).knowledgeLineageSchema;
    expect(schema.parse({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
  });

  it('parses affected assets without changing the REST contract', () => {
    const node = {
      id: 'field:Profit',
      type: 'FIELD',
      name: 'Profit',
      properties: {},
      sync_status: 'idle',
      last_synced_at: null,
    };
    const response = {
      node_id: 'field:Sales',
      affected_assets: [node],
    };
    expect((knowledgeApi as any).knowledgeNodeImpactSchema.parse(response)).toEqual(response);
  });
});

describe('semantic statement endpoints', () => {
  it('registers create, graph-list, node-list, and update routes with exact contracts', () => {
    expect(knowledgeApis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: 'createSemanticStatements',
          method: 'post',
          path: '/semantic-statements',
        }),
        expect.objectContaining({
          alias: 'listSemanticStatements',
          method: 'post',
          path: '/semantic-statements/search',
        }),
        expect.objectContaining({
          alias: 'listNodeSemanticStatements',
          method: 'post',
          path: '/nodes/:node_id/semantic-statements/search',
        }),
        expect.objectContaining({
          alias: 'updateSemanticStatements',
          method: 'patch',
          path: '/semantic-statements/:ctx_id',
        }),
      ]),
    );
  });

  it('preserves statement IDs, attachment state, and arbitrary properties', () => {
    const response = {
      id: 'semctx:1',
      type: 'SEMANTIC_CONTEXT',
      name: 'Revenue rules',
      properties: {
        statements: [{ id: 'stmt:1', statement: 'Revenue excludes refunds.' }],
        is_global: false,
        kind: 'statement',
        source: 'mcp',
        updated_at: '2026-08-12T15:04:05Z',
      },
      sync_status: 'idle',
      last_synced_at: null,
      target_node_id: 'field:Revenue',
    };
    const schema = (knowledgeApi as any).semanticStatementContextSchema;
    expect(schema).toBeDefined();
    expect(schema.parse(response)).toEqual(response);
  });

  it('parses backend datetimes with UTC offsets and microseconds', () => {
    const response = {
      id: 'semctx:1',
      type: 'SEMANTIC_CONTEXT',
      name: 'Revenue rules',
      properties: {
        statements: [{ id: 'stmt:1', statement: 'Revenue excludes refunds.' }],
        is_global: false,
        kind: 'statement',
        source: 'mcp',
        updated_at: '2026-08-18T05:48:39.123456+00:00',
      },
      last_synced_at: '2026-08-18T05:48:39.123456+00:00',
    };

    expect(knowledgeApi.semanticStatementContextSchema.parse(response)).toEqual(response);
  });

  it('requires exact semantic-context response fields and stored statement IDs', () => {
    const schema = (knowledgeApi as any).semanticStatementContextSchema;
    const base = {
      id: 'semctx:1',
      type: 'SEMANTIC_CONTEXT',
      name: 'Revenue rules',
      properties: {
        statements: [{ id: 'stmt:1', statement: 'Revenue excludes refunds.' }],
        is_global: false,
        kind: 'statement',
        source: 'mcp',
        updated_at: '2026-08-12T15:04:05Z',
      },
      target_node_id: 'field:Revenue',
    };

    expect(schema.safeParse({ ...base, type: 'FIELD' }).success).toBe(false);
    expect(
      schema.safeParse({
        ...base,
        properties: { ...base.properties, statements: [{ statement: 'Missing id.' }] },
      }).success,
    ).toBe(false);
    for (const field of ['kind', 'source', 'updated_at']) {
      const properties = { ...base.properties };
      delete properties[field as keyof typeof properties];
      expect(schema.safeParse({ ...base, properties }).success).toBe(false);
    }
  });
});

describe('knowledge endpoint request contracts', () => {
  it('accepts omitted and null optional search, resolve, edge, source, and suggestion filters', () => {
    expect(bodySchema('searchNodes').parse({ query: 'revenue' })).toEqual({ query: 'revenue' });
    expect(
      bodySchema('searchNodes').parse({
        query: 'revenue',
        node_type: null,
        scope_id: null,
        limit: null,
      }),
    ).toEqual({ query: 'revenue', node_type: null, scope_id: null, limit: null });
    expect(
      bodySchema('resolveNode').parse({
        query: 'revenue',
        node_type: null,
        scope_id: null,
        max_candidates: null,
      }),
    ).toEqual({ query: 'revenue', node_type: null, scope_id: null, max_candidates: null });
    expect(bodySchema('searchNodeRelationships').parse({})).toEqual({});
    expect(
      bodySchema('searchNodeRelationships').parse({
        node_id: null,
        query: null,
        edge_type: null,
        direction: null,
      }),
    ).toEqual({ node_id: null, query: null, edge_type: null, direction: null });
    expect(bodySchema('searchSources').parse({ node_type: 'CUSTOM_SOURCE' })).toEqual({
      node_type: 'CUSTOM_SOURCE',
    });
    expect(bodySchema('searchSources').parse({ node_type: null })).toEqual({ node_type: null });
    expect(bodySchema('searchSuggestions').parse({})).toEqual({});
    expect(
      bodySchema('searchSuggestions').parse({
        pds_id: null,
        severity: null,
        type: null,
        limit: null,
      }),
    ).toEqual({ pds_id: null, severity: null, type: null, limit: null });
  });

  it('accepts contract-supported nulls in semantic context bodies', () => {
    expect(
      bodySchema('createSemanticStatements').parse({
        statements: [{ statement: 'Revenue excludes refunds.', id: null }],
        target_node_id: null,
        is_global: null,
        name: null,
      }),
    ).toEqual({
      statements: [{ statement: 'Revenue excludes refunds.', id: null }],
      target_node_id: null,
      is_global: null,
      name: null,
    });
    expect(
      bodySchema('updateSemanticStatements').parse({
        statements: null,
        target_node_id: null,
        is_global: null,
        name: null,
      }),
    ).toEqual({ statements: null, target_node_id: null, is_global: null, name: null });
    expect(bodySchema('listSemanticStatements').parse({ is_global: null })).toEqual({
      is_global: null,
    });
  });
});
