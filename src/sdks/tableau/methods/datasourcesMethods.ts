import { Zodios } from '@zodios/core';

import { datasourcesApis } from '../apis/datasourcesApi.js';
import { Credentials } from '../types/credentials.js';
import { DataSource } from '../types/dataSource.js';
import { Pagination } from '../types/pagination.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Data Sources methods of the Tableau Server REST API
 *
 * @export
 * @class DatasourcesMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm
 */
export default class DatasourcesMethods extends AuthenticatedMethods<typeof datasourcesApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, datasourcesApis), creds);
  }

  /**
   * Returns a list of published data sources on the specified site.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param siteId - The Tableau site ID
   * @param filter - The filter string to filter datasources by
   * @param pageSize - The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.
   * @param pageNumber - The offset for paging. The default is 1.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_sources
   */
  listDatasources = async ({
    siteId,
    filter,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    filter: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<{ pagination: Pagination; datasources: DataSource[] }> => {
    const response = await this._apiClient.listDatasources({
      params: { siteId },
      queries: { filter, pageSize, pageNumber },
      ...this.authHeader,
    });
    return {
      pagination: response.pagination,
      datasources: response.datasources.datasource ?? [],
    };
  };

  /**
   * Returns information about the specified data source.
   *
   * Required scopes: `tableau:content:read`
   *
   * @param siteId - The Tableau site ID
   * @param datasourceId - The ID of the data source
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#query_data_source
   */
  queryDatasource = async ({
    siteId,
    datasourceId,
  }: {
    siteId: string;
    datasourceId: string;
  }): Promise<DataSource> => {
    return (
      await this._apiClient.queryDatasource({
        params: { siteId, datasourceId },
        ...this.authHeader,
      })
    ).datasource;
  };
}
