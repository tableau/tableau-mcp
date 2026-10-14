import { describe, expect, it } from 'vitest';

import {
  edgeTypeSchema,
  knowledgeLineageSchema,
  knowledgeNodeCandidateSchema,
  knowledgeNodeContextSchema,
  knowledgeNodeImpactSchema,
  knowledgeNodeRelationshipsSchema,
  knowledgeNodeSearchResponseSchema,
  knowledgeSourcesSchema,
  nodeTypeSchema,
  semanticContextNodeSchema,
  semanticStatementContextSchema,
  suggestionReportSchema,
} from './knowledge.js';

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

describe('knowledge node schemas', () => {
  const searchResponse = {
    matches: [
      {
        id: 'field-1',
        type: 'FIELD',
        name: 'Net Revenue',
        properties: { formula: '[Sales] - [Tax]' },
        score: 0.91,
        certified: true,
        semantic_statements: [{ id: 'stmt-1', statement: 'Revenue excludes tax.', score: 0.88 }],
      },
      {
        id: 'field-2',
        type: 'FIELD',
        name: 'Gross Revenue',
        properties: {},
        score: 0.72,
        semantic_statements: [],
      },
    ],
  };

  const nodeContext = {
    id: 'field-1',
    type: 'FIELD',
    name: 'Net Revenue',
    properties: { formula: '[Sales] - [Tax]' },
    semantic_statements: [{ id: 'stmt-1', statement: 'Revenue excludes tax.' }],
    connected_nodes: [{ id: 'table-1', name: 'Orders', type: 'TABLE', edge_type: 'CONTAINS' }],
  };

  it('parses ranked matches, each a node carrying scored semantic statements', () => {
    expect(knowledgeNodeSearchResponseSchema).toBeDefined();
    expect(knowledgeNodeSearchResponseSchema.parse(searchResponse)).toEqual(searchResponse);
  });

  it('rejects a match missing the required semantic_statements array', () => {
    const missing = { ...searchResponse.matches[0] };
    delete (missing as { semantic_statements?: unknown }).semantic_statements;
    expect(knowledgeNodeCandidateSchema.safeParse(missing).success).toBe(false);
  });

  it('parses a get-node NodeContext with statements and connected nodes', () => {
    expect(knowledgeNodeContextSchema).toBeDefined();
    expect(knowledgeNodeContextSchema.parse(nodeContext)).toEqual(nodeContext);
  });

  it('rejects a NodeContext missing connected_nodes', () => {
    const missing = { ...nodeContext };
    delete (missing as { connected_nodes?: unknown }).connected_nodes;
    expect(knowledgeNodeContextSchema.safeParse(missing).success).toBe(false);
  });
});

describe('knowledge traversal schemas', () => {
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
    expect(knowledgeNodeRelationshipsSchema.parse(response)).toEqual(response);
  });

  it('parses lineage including the successful missing-node empty response', () => {
    expect(knowledgeLineageSchema.parse({ nodes: [], edges: [] })).toEqual({
      nodes: [],
      edges: [],
    });
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
    expect(knowledgeNodeImpactSchema.parse(response)).toEqual(response);
  });
});

describe('semantic statement schemas', () => {
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
    expect(semanticStatementContextSchema).toBeDefined();
    expect(semanticStatementContextSchema.parse(response)).toEqual(response);
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

    expect(semanticStatementContextSchema.parse(response)).toEqual(response);
  });

  it('requires exact semantic-context response fields and stored statement IDs', () => {
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

    expect(semanticStatementContextSchema.safeParse({ ...base, type: 'FIELD' }).success).toBe(
      false,
    );
    expect(
      semanticStatementContextSchema.safeParse({
        ...base,
        properties: { ...base.properties, statements: [{ statement: 'Missing id.' }] },
      }).success,
    ).toBe(false);
    for (const field of ['kind', 'source', 'updated_at']) {
      const properties = { ...base.properties };
      delete properties[field as keyof typeof properties];
      expect(semanticStatementContextSchema.safeParse({ ...base, properties }).success).toBe(false);
    }
  });

  it('search response union parses a Tableau-managed external context', () => {
    const external = {
      id: 'semctx-ext:1',
      type: 'SEMANTIC_CONTEXT_EXTERNAL',
      name: 'Best practice',
      properties: {
        statements: [{ id: 'stmt:1', statement: 'Use certified sources.' }],
        source: 'tableau',
        updated_at: '2026-08-12T15:04:05Z',
        category: 'governance',
      },
      last_synced_at: null,
      target_node_id: 'field:Revenue',
    };
    expect(semanticContextNodeSchema.parse(external)).toEqual(external);
    // Only the search union accepts Tableau-managed contexts.
    expect(semanticStatementContextSchema.safeParse(external).success).toBe(false);
  });
});
