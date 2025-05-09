import { Zodios } from '@zodios/core';
import { z } from 'zod';

import { QueryOutput, QueryRequest, vizqlDataServiceApis } from '../apis/vizqlDataServiceApi.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

export default class VizqlDataServiceMethods extends AuthenticatedMethods<
  typeof vizqlDataServiceApis
> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, vizqlDataServiceApis), creds);
  }

  queryDatasource = async (
    queryRequest: z.infer<typeof QueryRequest>,
  ): Promise<z.infer<typeof QueryOutput>> => {
    return await this._apiClient.queryDatasource(queryRequest, { ...this.authHeader });
  };
}
