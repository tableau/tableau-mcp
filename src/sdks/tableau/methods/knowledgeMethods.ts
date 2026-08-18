import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { knowledgeApis, SuggestionReport, SuggestionSeverity } from '../apis/knowledgeApi.js';
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
    pdsId?: string;
    severity?: SuggestionSeverity;
    type?: string;
    limit?: number;
  }): Promise<SuggestionReport> =>
    this._apiClient.searchSuggestions(
      { pds_id: pdsId, severity, type, limit },
      { params: { graph_id: graphId }, ...this.authHeader },
    );
}
