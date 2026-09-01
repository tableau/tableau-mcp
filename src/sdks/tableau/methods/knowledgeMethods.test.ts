import { describe, expect, it, vi } from 'vitest';

import { KnowledgeNotAvailableError } from '../../../errors/mcpToolError.js';
import { axios } from '../../../utils/axios.js';
import KnowledgeMethods from './knowledgeMethods.js';

function make404(data: unknown): unknown {
  return new axios.AxiosError('Not Found', undefined, undefined, undefined, {
    status: 404,
    statusText: 'Not Found',
    headers: {},
    config: {} as never,
    data,
  });
}

describe('KnowledgeMethods', () => {
  it('forwards semantic statement bodies as snake_case with bearer auth', async () => {
    const createSemanticStatements = vi.fn().mockResolvedValue({});
    const listSemanticStatements = vi.fn().mockResolvedValue([]);
    const listNodeSemanticStatements = vi.fn().mockResolvedValue([]);
    const updateSemanticStatements = vi.fn().mockResolvedValue({});
    const deleteSemanticStatements = vi.fn().mockResolvedValue(undefined);
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = {
      createSemanticStatements,
      listSemanticStatements,
      listNodeSemanticStatements,
      updateSemanticStatements,
      deleteSemanticStatements,
    };

    await methods.createSemanticStatements({
      graphId: 'graph-1',
      statements: [{ statement: 'Revenue excludes refunds.' }],
      targetNodeId: null,
      isGlobal: null,
      name: null,
    });
    await (methods as any).listSemanticStatements({ graphId: 'graph-1', isGlobal: true });
    await (methods as any).listSemanticStatements({
      graphId: 'graph-1',
      nodeId: 'field/Revenue Total',
    });
    await methods.updateSemanticStatements({
      graphId: 'graph-1',
      contextId: 'semctx:rule 1',
      statements: null,
      isGlobal: null,
      name: null,
      targetNodeId: null,
    });
    await methods.deleteSemanticStatements({ graphId: 'graph-1', contextId: 'semctx:rule 1' });

    const auth = { headers: { Authorization: 'Bearer token' } };
    expect(createSemanticStatements).toHaveBeenCalledWith(
      {
        statements: [{ statement: 'Revenue excludes refunds.' }],
        target_node_id: null,
        is_global: null,
        name: null,
      },
      { queries: { graph_id: 'graph-1' }, ...auth },
    );
    expect(listSemanticStatements).toHaveBeenCalledWith(
      { is_global: true },
      { queries: { graph_id: 'graph-1' }, ...auth },
    );
    expect(listNodeSemanticStatements).toHaveBeenCalledWith(
      {},
      { params: { node_id: 'field%2FRevenue%20Total' }, queries: { graph_id: 'graph-1' }, ...auth },
    );
    expect(updateSemanticStatements).toHaveBeenCalledWith(
      {
        statements: null,
        target_node_id: null,
        is_global: null,
        name: null,
      },
      { params: { ctx_id: 'semctx%3Arule%201' }, queries: { graph_id: 'graph-1' }, ...auth },
    );
    expect(deleteSemanticStatements).toHaveBeenCalledWith(undefined, {
      params: { ctx_id: 'semctx%3Arule%201' },
      queries: { graph_id: 'graph-1' },
      ...auth,
    });
  });

  it('forwards relationship input as exact snake_case with bearer auth', async () => {
    const searchNodeRelationships = vi.fn().mockResolvedValue({ edges: [] });
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { searchNodeRelationships };

    expect((methods as any).getKnowledgeNodeRelationships).toBeTypeOf('function');
    await (methods as any).getKnowledgeNodeRelationships({
      graphId: 'graph-1',
      nodeId: 'field:Sales',
      edgeType: 'DEPENDS_ON',
      direction: 'incoming',
    });

    expect(searchNodeRelationships).toHaveBeenCalledWith(
      {
        node_id: 'field:Sales',
        query: undefined,
        edge_type: 'DEPENDS_ON',
        direction: 'incoming',
      },
      { queries: { graph_id: 'graph-1' }, headers: { Authorization: 'Bearer token' } },
    );
  });

  it('forwards lineage and impact path parameters', async () => {
    const getLineage = vi.fn().mockResolvedValue({ nodes: [], edges: [] });
    const getNodeImpact = vi.fn().mockResolvedValue({ node_id: 'x', affected_assets: [] });
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { getLineage, getNodeImpact };

    expect((methods as any).getKnowledgeLineage).toBeTypeOf('function');
    expect((methods as any).getKnowledgeNodeImpact).toBeTypeOf('function');
    await (methods as any).getKnowledgeLineage({
      graphId: 'graph-1',
      nodeId: 'field:Profit Ratio',
    });
    await (methods as any).getKnowledgeNodeImpact({
      graphId: 'graph-1',
      nodeId: 'field:Sales',
    });

    expect(getLineage).toHaveBeenCalledWith({
      params: { node_id: 'field%3AProfit%20Ratio' },
      queries: { graph_id: 'graph-1' },
      headers: { Authorization: 'Bearer token' },
    });
    expect(getNodeImpact).toHaveBeenCalledWith({
      params: { node_id: 'field%3ASales' },
      queries: { graph_id: 'graph-1' },
      headers: { Authorization: 'Bearer token' },
    });
  });

  it('URL-encodes supported lineage and impact node IDs through Zodios', async () => {
    const requests: any[] = [];
    const adapter = vi.fn(async (config: any) => {
      requests.push(config);
      return {
        data: config.url.includes('/impact')
          ? { node_id: 'x', affected_assets: [] }
          : { nodes: [], edges: [] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      };
    });
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      { adapter },
    );

    await (methods as any).getKnowledgeLineage({
      graphId: 'graph-1',
      nodeId: 'field:Profit Ratio',
    });
    await (methods as any).getKnowledgeNodeImpact({
      graphId: 'graph-1',
      nodeId: 'field:Profit Ratio',
    });

    expect(requests.map(({ url }) => url)).toEqual([
      '/lineage/field%3AProfit%20Ratio',
      '/nodes/field%3AProfit%20Ratio/impact',
    ]);
    expect(requests.map(({ params }) => params)).toEqual([
      { graph_id: 'graph-1' },
      { graph_id: 'graph-1' },
    ]);
  });
  it('forwards node search filters and limit with bearer auth', async () => {
    const searchNodes = vi.fn().mockResolvedValue({ nodes: [] });
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { searchNodes };

    expect((methods as any).searchKnowledgeNodes).toBeTypeOf('function');
    await (methods as any).searchKnowledgeNodes({
      graphId: 'graph-1',
      query: 'revenue',
      nodeType: 'FIELD',
      scopeId: 'pds-1',
      limit: 12,
    });

    expect(searchNodes).toHaveBeenCalledWith(
      { query: 'revenue', node_type: 'FIELD', scope_id: 'pds-1', limit: 12 },
      { queries: { graph_id: 'graph-1' }, headers: { Authorization: 'Bearer token' } },
    );
  });

  it('forwards omitted and null node search limits', async () => {
    const searchNodes = vi.fn().mockResolvedValue({ matches: [] });
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { searchNodes };

    await methods.searchKnowledgeNodes({ graphId: 'graph-1', query: 'revenue' });
    await methods.searchKnowledgeNodes({ graphId: 'graph-1', query: 'revenue', limit: null });

    expect(searchNodes.mock.calls.map(([body]) => body.limit)).toEqual([undefined, null]);
  });

  it('forwards node resolution filters and max candidates', async () => {
    const resolveNode = vi.fn().mockResolvedValue({ needs_disambiguation: true, node: null });
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      {
        type: 'X-Tableau-Auth',
        token: 'session-token',
        site: { id: 'site-1' },
        user: { id: 'user-1' },
      },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { resolveNode };

    expect((methods as any).getKnowledgeNode).toBeTypeOf('function');
    await (methods as any).getKnowledgeNode({
      graphId: 'graph-1',
      query: 'revenue',
      nodeType: 'FIELD',
      scopeId: 'pds-1',
      maxCandidates: 7,
    });

    expect(resolveNode).toHaveBeenCalledWith(
      { query: 'revenue', node_type: 'FIELD', scope_id: 'pds-1', max_candidates: 7 },
      { queries: { graph_id: 'graph-1' }, headers: { 'X-Tableau-Auth': 'session-token' } },
    );
  });

  it('forwards the graph path, snake_case body, and bearer auth', async () => {
    const searchSuggestions = vi.fn().mockResolvedValue({
      stats: { total_nodes: 0, total_relationships: 0, connected_sources: 0, workbooks: 0 },
      metrics: [],
      suggestions: [],
      categories: [],
      topics: [],
      summary: { total: 0, by_severity: {}, by_type: {}, by_category: {}, by_topic: {}, errors: 0 },
      errors: [],
    });
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { searchSuggestions };

    await methods.getKnowledgeSuggestions({
      graphId: 'graph-1',
      pdsId: 'pds-1',
      severity: 'medium',
      type: 'missing-description',
      limit: 5,
    });

    expect(searchSuggestions).toHaveBeenCalledWith(
      { pds_id: 'pds-1', severity: 'medium', type: 'missing-description', limit: 5 },
      { queries: { graph_id: 'graph-1' }, headers: { Authorization: 'Bearer token' } },
    );
  });

  it('forwards X-Tableau-Auth credentials', async () => {
    const searchSuggestions = vi.fn().mockResolvedValue({});
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      {
        type: 'X-Tableau-Auth',
        token: 'session-token',
        site: { id: 'site-1' },
        user: { id: 'user-1' },
      },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { searchSuggestions };

    await methods.getKnowledgeSuggestions({ graphId: 'graph-1' });

    expect(searchSuggestions).toHaveBeenCalledWith(
      { pds_id: undefined, severity: undefined, type: undefined, limit: undefined },
      { queries: { graph_id: 'graph-1' }, headers: { 'X-Tableau-Auth': 'session-token' } },
    );
  });

  it('lists filtered knowledge sources with bearer auth', async () => {
    const searchSources = vi.fn().mockResolvedValue([]);
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { searchSources };

    await methods.listKnowledgeSources({ graphId: 'graph-1', nodeType: 'PDS' });

    expect(searchSources).toHaveBeenCalledWith(
      { node_type: 'PDS' },
      { queries: { graph_id: 'graph-1' }, headers: { Authorization: 'Bearer token' } },
    );
  });

  it('forwards arbitrary and null source node type filters', async () => {
    const searchSources = vi.fn().mockResolvedValue([]);
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { searchSources };

    await methods.listKnowledgeSources({ graphId: 'graph-1', nodeType: 'CUSTOM_SOURCE' });
    await methods.listKnowledgeSources({ graphId: 'graph-1', nodeType: null });

    expect(searchSources.mock.calls.map(([body]) => body.node_type)).toEqual([
      'CUSTOM_SOURCE',
      null,
    ]);
  });

  it('always sends an unfiltered body with X-Tableau-Auth credentials', async () => {
    const searchSources = vi.fn().mockResolvedValue([]);
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      {
        type: 'X-Tableau-Auth',
        token: 'session-token',
        site: { id: 'site-1' },
        user: { id: 'user-1' },
      },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { searchSources };

    await methods.listKnowledgeSources({ graphId: 'graph-1' });

    expect(searchSources).toHaveBeenCalledWith(
      { node_type: undefined },
      { queries: { graph_id: 'graph-1' }, headers: { 'X-Tableau-Auth': 'session-token' } },
    );
  });

  it('maps a bare 404 with no error code to KnowledgeNotAvailableError (Tableau Server)', async () => {
    const searchNodes = vi.fn().mockRejectedValue(make404({}));
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { searchNodes };

    await expect(
      methods.searchKnowledgeNodes({ graphId: 'graph-1', query: 'revenue' }),
    ).rejects.toBeInstanceOf(KnowledgeNotAvailableError);
  });

  it('passes through a 404 that carries an error code (real knowledge not-found)', async () => {
    const error = make404({ code: 'graph_not_found' });
    const searchNodes = vi.fn().mockRejectedValue(error);
    const methods = new KnowledgeMethods(
      'https://tableau.example/api/v1/knowledge',
      { type: 'Bearer', token: 'token' },
      {},
    );
    // @ts-expect-error - Mocking private property
    methods._apiClient = { searchNodes };

    await expect(
      methods.searchKnowledgeNodes({ graphId: 'graph-1', query: 'revenue' }),
    ).rejects.toBe(error);
  });
});
