import { Zodios } from '@zodios/core';
import { z } from 'zod';

import {
  MetadataOutput,
  QueryOutput,
  QueryRequest,
  ReadMetadataRequest,
  vizqlDataServiceApis,
} from '../apis/vizqlDataServiceApi.js';
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

  readMetadata = async (
    readMetadataRequest: z.infer<typeof ReadMetadataRequest>,
  ): Promise<z.infer<typeof MetadataOutput>> => {
    return await this._apiClient.readMetadata(readMetadataRequest, { ...this.authHeader });
  };
}
