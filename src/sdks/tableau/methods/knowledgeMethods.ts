import { Zodios } from '@zodios/core';

import { KnowledgeNotAvailableError } from '../../../errors/mcpToolError.js';
import { AxiosRequestConfig, isAxiosError } from '../../../utils/axios.js';
import {
  knowledgeApis,
  KnowledgeLineage,
  KnowledgeNodeContext,
  KnowledgeNodeImpact,
  KnowledgeNodeRelationships,
  KnowledgeNodeSearchResponse,
  KnowledgeSource,
  KnowledgeSourceNodeType,
  SemanticContextNode,
  SemanticStatementContext,
  SemanticStatementInput,
  SuggestionReport,
  SuggestionSeverity,
} from '../apis/knowledgeApi.js';
import { RestApiCredentials } from '../restApi.js';
import AuthenticatedMethods from './authenticatedMethods.js';

// A bare 404 (no structured error code) means the knowledge route is absent —
// i.e. Tableau Server. Real knowledge 404s carry a `code` (e.g. graph_not_found).
async function guardKnowledgeAvailability<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404 && !error.response?.data?.code) {
      throw new KnowledgeNotAvailableError();
    }
    throw error;
  }
}

export default class KnowledgeMethods extends AuthenticatedMethods<typeof knowledgeApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, knowledgeApis, { axiosConfig }), creds);
  }

  getKnowledgeSuggestions = async ({
    graphId,
    pdsId,
    severity,
    type,
    limit,
  }: {
    graphId?: string;
    pdsId?: string | null;
    severity?: SuggestionSeverity | null;
    type?: string | null;
    limit?: number | null;
  }): Promise<SuggestionReport> =>
    guardKnowledgeAvailability(
      this._apiClient.searchSuggestions(
        { pds_id: pdsId, severity, type, limit },
        { queries: { graph_id: graphId }, ...this.authHeader },
      ),
    );

  listKnowledgeSources = async ({
    graphId,
    nodeType,
  }: {
    graphId?: string;
    nodeType?: KnowledgeSourceNodeType | null;
  }): Promise<KnowledgeSource[]> =>
    guardKnowledgeAvailability(
      this._apiClient.searchSources(
        { node_type: nodeType },
        { queries: { graph_id: graphId }, ...this.authHeader },
      ),
    );

  searchKnowledgeNodes = async ({
    graphId,
    query,
    nodeType,
    scopeId,
    limit,
  }: {
    graphId?: string;
    query: string;
    nodeType?: string | null;
    scopeId?: string | null;
    limit?: number | null;
  }): Promise<KnowledgeNodeSearchResponse> =>
    guardKnowledgeAvailability(
      this._apiClient.searchNodes(
        { query, node_type: nodeType, scope_id: scopeId, limit },
        { queries: { graph_id: graphId }, ...this.authHeader },
      ),
    );

  getKnowledgeNode = async ({
    graphId,
    nodeId,
    includeChildren,
  }: {
    graphId?: string;
    nodeId: string;
    includeChildren?: boolean | null;
  }): Promise<KnowledgeNodeContext> =>
    guardKnowledgeAvailability(
      this._apiClient.getNode({
        params: { node_id: encodeURIComponent(nodeId) },
        queries: { graph_id: graphId, include_children: includeChildren ?? undefined },
        ...this.authHeader,
      }),
    );

  getKnowledgeNodeRelationships = async ({
    graphId,
    nodeId,
    query,
    edgeType,
    direction,
  }: {
    graphId?: string;
    nodeId?: string | null;
    query?: string | null;
    edgeType?: string | null;
    direction?: 'outgoing' | 'incoming' | null;
  }): Promise<KnowledgeNodeRelationships> =>
    guardKnowledgeAvailability(
      this._apiClient.searchNodeRelationships(
        { node_id: nodeId, query, edge_type: edgeType, direction },
        { queries: { graph_id: graphId }, ...this.authHeader },
      ),
    );

  getKnowledgeLineage = async ({
    graphId,
    nodeId,
  }: {
    graphId?: string;
    nodeId: string;
  }): Promise<KnowledgeLineage> =>
    guardKnowledgeAvailability(
      this._apiClient.getLineage({
        params: { node_id: encodeURIComponent(nodeId) },
        queries: { graph_id: graphId },
        ...this.authHeader,
      }),
    );

  getKnowledgeNodeImpact = async ({
    graphId,
    nodeId,
  }: {
    graphId?: string;
    nodeId: string;
  }): Promise<KnowledgeNodeImpact> =>
    guardKnowledgeAvailability(
      this._apiClient.getNodeImpact({
        params: { node_id: encodeURIComponent(nodeId) },
        queries: { graph_id: graphId },
        ...this.authHeader,
      }),
    );

  createSemanticStatements = async ({
    graphId,
    statements,
    targetNodeId,
    isGlobal,
    name,
  }: {
    graphId?: string;
    statements: SemanticStatementInput[];
    targetNodeId?: string | null;
    isGlobal?: boolean | null;
    name?: string | null;
  }): Promise<SemanticStatementContext> =>
    guardKnowledgeAvailability(
      this._apiClient.createSemanticStatements(
        {
          statements,
          target_node_id: targetNodeId,
          is_global: isGlobal,
          name,
        },
        { queries: { graph_id: graphId }, ...this.authHeader },
      ),
    );

  listSemanticStatements = async ({
    graphId,
    nodeId,
    isGlobal,
  }: {
    graphId?: string;
    nodeId?: string;
    isGlobal?: boolean | null;
  }): Promise<SemanticContextNode[]> =>
    guardKnowledgeAvailability(
      nodeId === undefined
        ? this._apiClient.listSemanticStatements(
            { is_global: isGlobal },
            { queries: { graph_id: graphId }, ...this.authHeader },
          )
        : this._apiClient.listNodeSemanticStatements(
            {},
            {
              params: { node_id: encodeURIComponent(nodeId) },
              queries: { graph_id: graphId },
              ...this.authHeader,
            },
          ),
    );

  updateSemanticStatements = async ({
    graphId,
    contextId,
    statements,
    targetNodeId,
    isGlobal,
    name,
  }: {
    graphId?: string;
    contextId: string;
    statements?: SemanticStatementInput[] | null;
    targetNodeId?: string | null;
    isGlobal?: boolean | null;
    name?: string | null;
  }): Promise<SemanticStatementContext> =>
    guardKnowledgeAvailability(
      this._apiClient.updateSemanticStatements(
        {
          statements,
          target_node_id: targetNodeId,
          is_global: isGlobal,
          name,
        },
        {
          params: { ctx_id: encodeURIComponent(contextId) },
          queries: { graph_id: graphId },
          ...this.authHeader,
        },
      ),
    );

  deleteSemanticStatements = async ({
    graphId,
    contextId,
  }: {
    graphId?: string;
    contextId: string;
  }): Promise<void> => {
    await guardKnowledgeAvailability(
      this._apiClient.deleteSemanticStatements(undefined, {
        params: { ctx_id: encodeURIComponent(contextId) },
        queries: { graph_id: graphId },
        ...this.authHeader,
      }),
    );
  };
}
