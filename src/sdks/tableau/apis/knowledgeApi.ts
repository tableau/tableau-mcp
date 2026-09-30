import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import {
  knowledgeGraphSchema,
  knowledgeLineageSchema,
  knowledgeNodeContextSchema,
  knowledgeNodeImpactSchema,
  knowledgeNodeRelationshipsSchema,
  knowledgeNodeSearchResponseSchema,
  knowledgeSourceNodeTypeSchema,
  knowledgeSourcesSchema,
  semanticContextNodeSchema,
  semanticStatementContextSchema,
  semanticStatementInputSchema,
  severitySchema,
  suggestionReportSchema,
} from '../types/knowledge.js';

const knowledgeGraphListSchema = z.object({ graphs: z.array(knowledgeGraphSchema) });

const createSemanticStatementsBodySchema = z.object({
  statements: z.array(semanticStatementInputSchema),
  target_node_id: z.string().nullable().optional(),
  is_global: z.boolean().nullable().optional(),
  name: z.string().nullable().optional(),
});
const updateSemanticStatementsBodySchema = createSemanticStatementsBodySchema
  .omit({ statements: true })
  .extend({ statements: z.array(semanticStatementInputSchema).nullable().optional() });

const listGraphsEndpoint = makeEndpoint({
  method: 'get',
  path: '/graphs',
  alias: 'listGraphs',
  description: "Lists the caller's site's knowledge graphs.",
  response: knowledgeGraphListSchema,
});

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
        node_type: z.string().nullable().optional(),
        scope_id: z.string().nullable().optional(),
        limit: z.number().int().nullable().optional(),
        threshold: z.number().nullable().optional(),
      }),
    },
  ],
  response: knowledgeNodeSearchResponseSchema,
});

const getNodeEndpoint = makeEndpoint({
  method: 'get',
  path: '/nodes/:node_id',
  alias: 'getNode',
  description: 'Fetches a knowledge node by id with its statements and connected nodes.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    { name: 'include_children', type: 'Query', schema: z.boolean().optional() },
    { name: 'node_id', type: 'Path', schema: z.string() },
  ],
  response: knowledgeNodeContextSchema,
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
        node_id: z.string().nullable().optional(),
        query: z.string().nullable().optional(),
        edge_type: z.string().nullable().optional(),
        direction: z.enum(['outgoing', 'incoming']).nullable().optional(),
      }),
    },
  ],
  response: knowledgeNodeRelationshipsSchema,
});

const getLineageEndpoint = makeEndpoint({
  method: 'get',
  path: '/nodes/:node_id/lineage',
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
  path: '/semantic-contexts',
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
  path: '/semantic-contexts/search',
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
  response: z.array(semanticContextNodeSchema),
});

const listNodeSemanticStatementsEndpoint = makeEndpoint({
  method: 'post',
  path: '/nodes/:node_id/semantic-contexts/search',
  alias: 'listNodeSemanticStatements',
  description: 'Lists attached and global semantic statements for a knowledge node.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    { name: 'node_id', type: 'Path', schema: z.string() },
    { name: 'body', type: 'Body', schema: z.object({}) },
  ],
  response: z.array(semanticContextNodeSchema),
});

const updateSemanticStatementsEndpoint = makeEndpoint({
  method: 'patch',
  path: '/semantic-contexts/:ctx_id',
  alias: 'updateSemanticStatements',
  description: 'Updates semantic statements or their attachment.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    { name: 'ctx_id', type: 'Path', schema: z.string() },
    { name: 'body', type: 'Body', schema: updateSemanticStatementsBodySchema },
  ],
  response: semanticStatementContextSchema,
});

const deleteSemanticStatementsEndpoint = makeEndpoint({
  method: 'delete',
  path: '/semantic-contexts/:ctx_id',
  alias: 'deleteSemanticStatements',
  description: 'Deletes a Knowledge-managed semantic context and its statements.',
  parameters: [
    { name: 'graph_id', type: 'Query', schema: z.string().optional() },
    { name: 'ctx_id', type: 'Path', schema: z.string() },
  ],
  // The Knowledge service returns 204 with an empty-string body, which z.void() rejects.
  response: z.union([z.void(), z.literal('')]),
});

const knowledgeApi = makeApi([
  listGraphsEndpoint,
  searchSuggestionsEndpoint,
  searchSourcesEndpoint,
  searchNodesEndpoint,
  getNodeEndpoint,
  searchNodeRelationshipsEndpoint,
  getLineageEndpoint,
  getNodeImpactEndpoint,
  createSemanticStatementsEndpoint,
  listSemanticStatementsEndpoint,
  listNodeSemanticStatementsEndpoint,
  updateSemanticStatementsEndpoint,
  deleteSemanticStatementsEndpoint,
]);
export const knowledgeApis = [...knowledgeApi] as const satisfies ZodiosEndpointDefinitions;
