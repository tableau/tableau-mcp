import { Zodios } from '@zodios/core';

import { GraphQLResponse, metadataApis } from '../apis/metadataApi.js';
import AuthenticatedMethods, { Auth } from './authenticatedMethods.js';

export default class MetadataMethods extends AuthenticatedMethods<typeof metadataApis> {
  constructor(baseUrl: string, auth: Auth) {
    super(new Zodios(baseUrl, metadataApis), auth);
  }

  graphql = async (query: string): Promise<GraphQLResponse> => {
    return await this._apiClient.graphql({ query }, { ...this.authHeader });
  };
}
