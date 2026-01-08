import { isErrorFromAlias, Zodios, ZodiosError } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import {
  MetadataResponse,
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
  constructor(baseUrl: string, creds: Credentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, vizqlDataServiceApis, { axiosConfig }), creds);
  }

  /**
   * Queries a specific data source and returns the resulting data.
   *
   * Required scopes: `tableau:viz_data_service:read`
   *
   * @param {QueryRequest} queryRequest
   * @link https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/QueryDatasource
   */
  queryDatasource = async (
    queryRequest: QueryRequest,
  ): Promise<Result<QueryOutput, 'feature-disabled' | TableauError | ZodiosError>> => {
    try {
      return Ok(await this._apiClient.queryDatasource(queryRequest, { ...this.authHeader }));
    } catch (error) {
      if (isErrorFromAlias(this._apiClient.api, 'queryDatasource', error)) {
        if (error.response.status === 404) {
          return Err('feature-disabled');
        }

        return Err(error.response.data);
      }

      if (error instanceof ZodiosError) {
        return Err(error);
      }

      throw error;
    }
  };

  /**
   * Requests metadata for a specific data source. The metadata provides information about the data fields, such as field names, data types, and descriptions.
   *
   * Required scopes: `tableau:viz_data_service:read`
   *
   * @param {ReadMetadataRequest} readMetadataRequest
   * @link https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/ReadMetadata
   */
  readMetadata = async (
    readMetadataRequest: ReadMetadataRequest,
  ): Promise<Result<MetadataResponse, 'feature-disabled'>> => {
    try {
      return Ok(await this._apiClient.readMetadata(readMetadataRequest, { ...this.authHeader }));
    } catch (error) {
      if (
        isErrorFromAlias(this._apiClient.api, 'readMetadata', error) &&
        error.response.status === 404
      ) {
        return Err('feature-disabled');
      }

      throw error;
    }
  };
}
