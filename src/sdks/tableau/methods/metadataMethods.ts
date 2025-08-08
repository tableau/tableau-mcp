import { Zodios } from '@zodios/core';

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
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, metadataApis), creds);
  }

  /**
   * Executes a GraphQL query against the Tableau Server.
   *
   * Required scopes: `tableau:content:read`
   *
   * @link https://help.tableau.com/current/api/metadata_api/en-us/index.html
   *
   * @param {string} query
   */
  graphql = async (query: string): Promise<GraphQLResponse> => {
    return await this._apiClient.graphql({ query }, { ...this.authHeader });
  };
}
