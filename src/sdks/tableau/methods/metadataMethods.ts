import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { GraphQLResponse, metadataApis } from '../apis/metadataApi.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Metadata methods of the Tableau Server REST API
 *
 * @export
 * @class MetadataMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_metadata.htm
 */
export default class MetadataMethods extends AuthenticatedMethods<typeof metadataApis> {
  constructor(baseUrl: string, creds: Credentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, metadataApis, { axiosConfig }), creds);
  }

  /**
   * Executes a GraphQL query against the Tableau Server.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param {string} query
   * @link https://help.tableau.com/current/api/metadata_api/en-us/index.html
   */
  graphql = async (query: string): Promise<GraphQLResponse> => {
    return await this._apiClient.graphql({ query }, { ...this.authHeader });
  };
}
