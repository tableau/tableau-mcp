import { Zodios } from '@zodios/core';
import { z } from 'zod';

import { QueryOutput, QueryRequest, vizqlDataServiceApis } from '../apis/vizqlDataServiceApi.js';
import AuthenticatedMethods from './authenticatedMethods.js';

export default class VizqlDataServiceMethods extends AuthenticatedMethods<
  typeof vizqlDataServiceApis
> {
  constructor(baseUrl: string, token: string) {
    super(new Zodios(baseUrl, vizqlDataServiceApis), token);
  }

  queryDatasource = async (
    queryRequest: z.infer<typeof QueryRequest>,
  ): Promise<z.infer<typeof QueryOutput>> => {
    return await this._apiClient.queryDatasource(queryRequest, { ...this.authHeader });
  };
}
