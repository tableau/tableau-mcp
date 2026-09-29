import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';

import { knowledgeApis } from './knowledgeApi.js';

const bodySchema = (alias: string): ZodTypeAny => {
  const endpoint = knowledgeApis.find((candidate) => candidate.alias === alias);
  if (!endpoint || !('parameters' in endpoint)) throw new Error(`No parameters for ${alias}`);
  return endpoint.parameters.find((parameter) => parameter.type === 'Body')!.schema;
};

describe('knowledge graph discovery', () => {
  it('registers the graph list endpoint and parses lifecycle metadata', () => {
    const endpoint = knowledgeApis.find(({ alias }) => alias === 'listGraphs');
    const response = {
      graphs: [
        {
          id: 'graph-1',
          name: 'Primary',
          description: '',
          status: 'active',
          is_primary: true,
          created_at: null,
          updated_at: '2026-09-14T20:00:00Z',
        },
      ],
    };

    expect(endpoint).toMatchObject({ method: 'get', path: '/graphs' });
    expect(endpoint?.response.parse(response)).toEqual(response);
  });
});

describe('knowledge node endpoints', () => {
  it('registers the search POST and get-node GET endpoints with the backend paths', () => {
    expect(knowledgeApis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: 'searchNodes',
          method: 'post',
          path: '/nodes/search',
        }),
        expect.objectContaining({
          alias: 'getNode',
          method: 'get',
          path: '/nodes/:node_id',
        }),
      ]),
    );
  });
});

describe('delete semantic context response', () => {
  it('accepts the empty-string 204 body the Knowledge service returns', () => {
    const del = knowledgeApis.find((e) => e.alias === 'deleteSemanticStatements')!;
    expect(del.response.safeParse('').success).toBe(true);
    expect(del.response.safeParse(undefined).success).toBe(true);
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
          path: '/nodes/:node_id/lineage',
        }),
        expect.objectContaining({
          alias: 'getNodeImpact',
          method: 'get',
          path: '/nodes/:node_id/impact',
        }),
      ]),
    );
  });
});

describe('semantic statement endpoints', () => {
  it('registers create, graph-list, node-list, and update routes with exact contracts', () => {
    expect(knowledgeApis).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          alias: 'createSemanticStatements',
          method: 'post',
          path: '/semantic-contexts',
        }),
        expect.objectContaining({
          alias: 'listSemanticStatements',
          method: 'post',
          path: '/semantic-contexts/search',
        }),
        expect.objectContaining({
          alias: 'listNodeSemanticStatements',
          method: 'post',
          path: '/nodes/:node_id/semantic-contexts/search',
        }),
        expect.objectContaining({
          alias: 'updateSemanticStatements',
          method: 'patch',
          path: '/semantic-contexts/:ctx_id',
        }),
      ]),
    );
  });
});

describe('knowledge endpoint request contracts', () => {
  it('accepts omitted and null optional search, edge, source, and suggestion filters', () => {
    expect(bodySchema('searchNodes').parse({ query: 'revenue' })).toEqual({ query: 'revenue' });
    expect(
      bodySchema('searchNodes').parse({
        query: 'revenue',
        node_type: null,
        scope_id: null,
        limit: null,
        threshold: null,
      }),
    ).toEqual({ query: 'revenue', node_type: null, scope_id: null, limit: null, threshold: null });
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
