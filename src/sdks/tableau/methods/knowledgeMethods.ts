import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import {
  knowledgeApis,
  KnowledgeLineage,
  KnowledgeNodeImpact,
  KnowledgeNodeRelationships,
  KnowledgeNodeResolveResponse,
  KnowledgeNodeSearchResponse,
  KnowledgeSource,
  KnowledgeSourceNodeType,
  SemanticStatementContext,
  SemanticStatementInput,
  SuggestionReport,
  SuggestionSeverity,
} from '../apis/knowledgeApi.js';
import { RestApiCredentials } from '../restApi.js';
import AuthenticatedMethods from './authenticatedMethods.js';

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
    graphId: string;
    pdsId?: string | null;
    severity?: SuggestionSeverity | null;
    type?: string | null;
    limit?: number | null;
  }): Promise<SuggestionReport> =>
    this._apiClient.searchSuggestions(
      { pds_id: pdsId, severity, type, limit },
      { params: { graph_id: graphId }, ...this.authHeader },
    );

  listKnowledgeSources = async ({
    graphId,
    nodeType,
  }: {
    graphId: string;
    nodeType?: KnowledgeSourceNodeType | null;
  }): Promise<KnowledgeSource[]> =>
    this._apiClient.searchSources(
      { node_type: nodeType },
      { params: { graph_id: graphId }, ...this.authHeader },
    );

  searchKnowledgeNodes = async ({
    graphId,
    query,
    nodeType,
    scopeId,
    limit,
  }: {
    graphId: string;
    query: string;
    nodeType?: string | null;
    scopeId?: string | null;
    limit?: number | null;
  }): Promise<KnowledgeNodeSearchResponse> =>
    this._apiClient.searchNodes(
      { query, node_type: nodeType, scope_id: scopeId, limit },
      { params: { graph_id: graphId }, ...this.authHeader },
    );

  getKnowledgeNode = async ({
    graphId,
    query,
    nodeType,
    scopeId,
    maxCandidates,
  }: {
    graphId: string;
    query: string;
    nodeType?: string | null;
    scopeId?: string | null;
    maxCandidates?: number | null;
  }): Promise<KnowledgeNodeResolveResponse> =>
    this._apiClient.resolveNode(
      { query, node_type: nodeType, scope_id: scopeId, max_candidates: maxCandidates },
      { params: { graph_id: graphId }, ...this.authHeader },
    );

  getKnowledgeNodeRelationships = async ({
    graphId,
    nodeId,
    query,
    edgeType,
    direction,
  }: {
    graphId: string;
    nodeId?: string | null;
    query?: string | null;
    edgeType?: string | null;
    direction?: 'outgoing' | 'incoming' | null;
  }): Promise<KnowledgeNodeRelationships> =>
    this._apiClient.searchNodeRelationships(
      { node_id: nodeId, query, edge_type: edgeType, direction },
      { params: { graph_id: graphId }, ...this.authHeader },
    );

  getKnowledgeLineage = async ({
    graphId,
    nodeId,
  }: {
    graphId: string;
    nodeId: string;
  }): Promise<KnowledgeLineage> =>
    this._apiClient.getLineage({
      params: { graph_id: graphId, node_id: encodeURIComponent(nodeId) },
      ...this.authHeader,
    });

  getKnowledgeNodeImpact = async ({
    graphId,
    nodeId,
  }: {
    graphId: string;
    nodeId: string;
  }): Promise<KnowledgeNodeImpact> =>
    this._apiClient.getNodeImpact({
      params: { graph_id: graphId, node_id: encodeURIComponent(nodeId) },
      ...this.authHeader,
    });

  createSemanticStatements = async ({
    graphId,
    statements,
    targetNodeId,
    isGlobal,
    name,
  }: {
    graphId: string;
    statements: SemanticStatementInput[];
    targetNodeId?: string | null;
    isGlobal?: boolean | null;
    name?: string | null;
  }): Promise<SemanticStatementContext> =>
    this._apiClient.createSemanticStatements(
      {
        statements,
        target_node_id: targetNodeId,
        is_global: isGlobal,
        name,
      },
      { params: { graph_id: graphId }, ...this.authHeader },
    );

  listSemanticStatements = async ({
    graphId,
    nodeId,
    isGlobal,
  }: {
    graphId: string;
    nodeId?: string;
    isGlobal?: boolean | null;
  }): Promise<SemanticStatementContext[]> =>
    nodeId === undefined
      ? this._apiClient.listSemanticStatements(
          { is_global: isGlobal },
          { params: { graph_id: graphId }, ...this.authHeader },
        )
      : this._apiClient.listNodeSemanticStatements(
          {},
          {
            params: { graph_id: graphId, node_id: encodeURIComponent(nodeId) },
            ...this.authHeader,
          },
        );

  updateSemanticStatements = async ({
    graphId,
    contextId,
    statements,
    targetNodeId,
    isGlobal,
    name,
  }: {
    graphId: string;
    contextId: string;
    statements?: SemanticStatementInput[] | null;
    targetNodeId?: string | null;
    isGlobal?: boolean | null;
    name?: string | null;
  }): Promise<SemanticStatementContext> =>
    this._apiClient.updateSemanticStatements(
      {
        statements,
        target_node_id: targetNodeId,
        is_global: isGlobal,
        name,
      },
      {
        params: { graph_id: graphId, ctx_id: encodeURIComponent(contextId) },
        ...this.authHeader,
      },
    );
}
