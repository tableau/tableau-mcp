import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { datasourcesApis } from '../apis/datasourcesApi.js';
import { RestApiCredentials } from '../restApi.js';
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
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, datasourcesApis, { axiosConfig }), creds);
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

  /**
   * Deletes the specified published data source from the site.
   *
   * On Tableau Cloud the data source is moved to the recycle bin and can be restored
   * for a limited time before permanent removal.
   *
   * Required scopes (Tableau Cloud): `tableau:datasources:delete`
   *
   * @param datasourceId - The ID of the data source to delete.
   * @param siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#delete_data_source
   */
  deleteDatasource = async ({
    datasourceId,
    siteId,
  }: {
    datasourceId: string;
    siteId: string;
  }): Promise<void> => {
    await this._apiClient.deleteDatasource(undefined, {
      params: { siteId, datasourceId },
      ...this.authHeader,
    });
  };

  /**
   * Adds one or more tags to the specified data source.
   *
   * Required scopes (Tableau Cloud): `tableau:datasource_tags:update`
   *
   * @param datasourceId - The ID of the data source to tag.
   * @param siteId - The Tableau site ID
   * @param tagLabels - The tag labels to add.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#add_tags_to_data_source
   */
  addTagsToDatasource = async ({
    datasourceId,
    siteId,
    tagLabels,
  }: {
    datasourceId: string;
    siteId: string;
    tagLabels: ReadonlyArray<string>;
  }): Promise<void> => {
    await this._apiClient.addTagsToDatasource(
      { tags: { tag: tagLabels.map((label) => ({ label })) } },
      {
        params: { siteId, datasourceId },
        ...this.authHeader,
      },
    );
  };
}
