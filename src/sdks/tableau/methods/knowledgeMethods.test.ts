import { describe, expect, it, vi } from 'vitest';

import KnowledgeMethods from './knowledgeMethods.js';

describe('KnowledgeMethods', () => {
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
      { params: { graph_id: 'graph-1' }, headers: { Authorization: 'Bearer token' } },
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
      { params: { graph_id: 'graph-1' }, headers: { 'X-Tableau-Auth': 'session-token' } },
    );
  });
});
