import { Zodios } from '@zodios/core';

import { GraphQLResponse, metadataApis } from '../apis/metadataApi.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

export default class MetadataMethods extends AuthenticatedMethods<typeof metadataApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, metadataApis), creds);
  }

  graphql = async (query: string): Promise<GraphQLResponse> => {
    return await this._apiClient.graphql({ query }, { ...this.authHeader });
  };
}
