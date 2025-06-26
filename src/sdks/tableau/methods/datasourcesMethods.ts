import { Zodios } from '@zodios/core';

import { Datasource, datasourcesApis } from '../apis/datasourcesApi.js';
import { Credentials } from '../types/credentials.js';
import { Pagination } from '../types/pagination.js';
import AuthenticatedMethods from './authenticatedMethods.js';

export default class DatasourcesMethods extends AuthenticatedMethods<typeof datasourcesApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, datasourcesApis), creds);
  }

  /**
   * Returns a list of published data sources on the specified site.
   * @param siteId - The Tableau site ID
   * @param filter - The filter string to filter datasources by
   * @param pageSize - The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.
   * @param pageNumber - The offset for paging. The default is 1.
   */
  listDatasources = async (
    siteId: string,
    filter: string,
    pageSize?: number,
    pageNumber?: number,
  ): Promise<{ pagination: Pagination; datasources: Datasource[] }> => {
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
}
