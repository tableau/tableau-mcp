import { isErrorFromAlias, Zodios, ZodiosError } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import {
  DatasourceModelResponse,
  GetDatasourceModelRequest,
  MetadataResponse,
  QueryOutput,
  QueryPermissionsOutput,
  QueryRequest,
  ReadMetadataRequest,
  TableauError,
  UserHasQueryPermissionsRequest,
  vizqlDataServiceApis,
} from '../apis/vizqlDataServiceApi.js';
import { RestApiCredentials } from '../restApi.js';
import AuthenticatedMethods from './authenticatedMethods.js';

// Signals that a VDS error is the `VDSForWorkbookDatasources` gate: the site-scoped flag (opt-in per
// site, no discovery endpoint) that must be on to query an embedded (workbook) datasource. Catching
// this error is the only client-side way to detect the gate. Exported so other VDS paths can reuse
// the predicate rather than re-deriving these signals.
//
// The distinctive flag identifier appears in the error `message` on every enforcement path and in
// both debug and non-debug responses, so it is the primary signal. The hex `tab-error-code` is an
// exact secondary signal, but only surfaces at the top level on non-debug requests — on debug
// requests (which query-datasource sends) the top-level field is dropped and the hex is buried in
// the `debug` tree, so it can't be relied on alone. The numeric `errorCode` is unusable: it is the
// generic `501000` (NOT_IMPLEMENTED), shared by unrelated errors.
export const WORKBOOK_DS_NOT_ENABLED_FLAG = 'VDSForWorkbookDatasources';
export const WORKBOOK_DS_NOT_ENABLED_CODE = '0x4A7F2B19';

export function isWorkbookDatasourceNotEnabled(error: TableauError | undefined): boolean {
  if (!error) {
    return false;
  }
  const flagInMessage =
    error.message?.toLowerCase().includes(WORKBOOK_DS_NOT_ENABLED_FLAG.toLowerCase()) ?? false;
  const codeMatches =
    error['tab-error-code']?.toLowerCase() === WORKBOOK_DS_NOT_ENABLED_CODE.toLowerCase();
  return flagInMessage || codeMatches;
}

export type VdsQueryError =
  | { type: 'feature-disabled' }
  | { type: 'workbook-datasource-not-enabled' }
  | { type: 'api-error'; message: string; httpStatus: number; errorCode: string | undefined }
  | { type: 'zodios-error'; error: ZodiosError };

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
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
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
  ): Promise<Result<QueryOutput, VdsQueryError>> => {
    try {
      return Ok(await this._apiClient.queryDatasource(queryRequest, { ...this.authHeader }));
    } catch (error) {
      if (isErrorFromAlias(this._apiClient.api, 'queryDatasource', error)) {
        // Check the workbook-datasource gate independent of HTTP status and BEFORE the 404 branch:
        // it arrives as a 501 today, but detection keys off the error body (see the predicate), not
        // the status, so ordering it first keeps it from ever being mislabeled as VizQL-disabled.
        if (isWorkbookDatasourceNotEnabled(error.response.data)) {
          return Err({ type: 'workbook-datasource-not-enabled' });
        }
        if (error.response.status === 404) {
          return Err({ type: 'feature-disabled' });
        }
        return Err({
          type: 'api-error',
          message: error.response.data.message ?? 'Unknown Tableau error',
          httpStatus: 400,
          errorCode: error.response.data.errorCode,
        });
      }

      if (error instanceof ZodiosError) {
        return Err({ type: 'zodios-error', error });
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

  /**
   * Requests the data model for a specific data source, including logical tables and relationships.
   *
   * Required scopes: `tableau:viz_data_service:read`
   *
   * @param {GetDatasourceModelRequest} getDatasourceModelRequest
   * @link https://help.tableau.com/current/api/vizql-data-service/en-us/reference/index.html#tag/HeadlessBI/operation/GetDatasourceModel
   */
  getDatasourceModel = async (
    getDatasourceModelRequest: GetDatasourceModelRequest,
  ): Promise<Result<DatasourceModelResponse, 'feature-disabled'>> => {
    try {
      return Ok(
        await this._apiClient.getDatasourceModel(getDatasourceModelRequest, {
          ...this.authHeader,
        }),
      );
    } catch (error) {
      if (
        isErrorFromAlias(this._apiClient.api, 'getDatasourceModel', error) &&
        error.response.status === 404
      ) {
        return Err('feature-disabled');
      }

      throw error;
    }
  };

  /**
   * Checks whether the calling user has permission to query the specified data source via VDS.
   * HTTP errors are returned as a `VdsQueryError`, not thrown.
   *
   * Required scopes: `tableau:viz_data_service:read`
   *
   * @param {UserHasQueryPermissionsRequest} request
   */
  userHasQueryPermissions = async (
    request: UserHasQueryPermissionsRequest,
  ): Promise<Result<QueryPermissionsOutput, VdsQueryError>> => {
    try {
      return Ok(await this._apiClient.userHasQueryPermissions(request, { ...this.authHeader }));
    } catch (error) {
      if (isErrorFromAlias(this._apiClient.api, 'userHasQueryPermissions', error)) {
        const status: number = error.response.status;
        const errorCode = error.response.data?.errorCode;
        const message = error.response.data?.message;

        // feature-disabled is reserved for *systemic* failures that apply to every data source,
        // not just the one requested:
        //  - 404950: the endpoint is absent on an older server.
        //  - a 403 whose message says the feature "is not enabled": VDS is switched off site-wide.
        //    (errorCode 403800 is overloaded — it also signals a per-data-source denial — so the
        //    message is the only reliable discriminator.)
        // Everything else (per-data-source denials, not-found data sources, auth failures,
        // transient errors) is surfaced as api-error for the caller to interpret per data source.
        if (
          errorCode === '404950' ||
          (status === 403 && (message ?? '').toLowerCase().includes('not enabled'))
        ) {
          return Err({ type: 'feature-disabled' });
        }

        return Err({
          type: 'api-error',
          message: message ?? 'Unknown Tableau error',
          httpStatus: status,
          errorCode,
        });
      }

      if (error instanceof ZodiosError) {
        return Err({ type: 'zodios-error', error });
      }

      throw error;
    }
  };
}
