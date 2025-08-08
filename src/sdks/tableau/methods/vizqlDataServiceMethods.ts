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
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * The VizQL Data Service (VDS) provides a programmatic way for you to access your published data outside of a Tableau visualization.
 *
 * @export
 * @class VizqlDataServiceMethods
 * @extends {AuthenticatedMethods<typeof vizqlDataServiceApis>}
 * @link https://help.tableau.com/current/api/vizql-data-service/en-us/index.html
 */
export default class VizqlDataServiceMethods extends AuthenticatedMethods<
  typeof vizqlDataServiceApis
> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, vizqlDataServiceApis), creds);
  }

  /**
   * Queries a specific data source and returns the resulting data.
   *
   * Required scopes: `tableau:viz_data_service:read`
   *
   * @param {z.infer<typeof QueryRequest>} queryRequest
   * @link https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource
   */
  queryDatasource = async (
    queryRequest: z.infer<typeof QueryRequest>,
  ): Promise<Result<QueryOutput, TableauError>> => {
    try {
      return Ok(await this._apiClient.queryDatasource(queryRequest, { ...this.authHeader }));
    } catch (error) {
      if (isErrorFromAlias(this._apiClient.api, 'queryDatasource', error)) {
        return Err(error.response.data);
      }

      throw error;
    }
  };

  /**
   * Requests metadata for a specific data source. The metadata provides information about the data fields, such as field names, data types, and descriptions.
   *
   * Required scopes: `tableau:viz_data_service:read`
   *
   * @param {z.infer<typeof ReadMetadataRequest>} readMetadataRequest
   * @link https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/ReadMetadata
   */
  readMetadata = async (
    readMetadataRequest: z.infer<typeof ReadMetadataRequest>,
  ): Promise<z.infer<typeof MetadataOutput>> => {
    return await this._apiClient.readMetadata(readMetadataRequest, { ...this.authHeader });
  };
}
