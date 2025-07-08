import { isErrorFromAlias, Zodios } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  MetadataOutput,
  QueryOutput,
  QueryRequest,
  ReadMetadataRequest,
  TableauError,
  vizqlDataServiceApis,
} from '../apis/vizqlDataServiceApi.js';
import AuthenticatedMethods, { Auth } from './authenticatedMethods.js';

export default class VizqlDataServiceMethods extends AuthenticatedMethods<
  typeof vizqlDataServiceApis
> {
  constructor(baseUrl: string, auth: Auth) {
    super(new Zodios(baseUrl, vizqlDataServiceApis), auth);
  }

  queryDatasource = async (
    queryRequest: z.infer<typeof QueryRequest>,
  ): Promise<Result<z.infer<typeof QueryOutput>, z.infer<typeof TableauError>>> => {
    try {
      return Ok(await this._apiClient.queryDatasource(queryRequest, { ...this.authHeader }));
    } catch (error) {
      if (isErrorFromAlias(this._apiClient.api, 'queryDatasource', error)) {
        return Err(error.response.data);
      }

      throw error;
    }
  };

  readMetadata = async (
    readMetadataRequest: z.infer<typeof ReadMetadataRequest>,
  ): Promise<z.infer<typeof MetadataOutput>> => {
    return await this._apiClient.readMetadata(readMetadataRequest, { ...this.authHeader });
  };
}
