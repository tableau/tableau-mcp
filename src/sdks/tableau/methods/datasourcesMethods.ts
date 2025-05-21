import { Zodios } from '@zodios/core';

import { Datasource, datasourcesApis } from '../apis/datasourcesApi.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

export default class DatasourcesMethods extends AuthenticatedMethods<typeof datasourcesApis> {
  constructor(baseUrl: string, creds: Credentials) {
    super(new Zodios(baseUrl, datasourcesApis), creds);
  }

  /**
   * Returns a list of published data sources on the specified site.
   * @param siteId - The Tableau site ID
   * @param filter - The filter string to filter datasources by
   */
  listDatasources = async (siteId: string, filter: string): Promise<Datasource[]> => {
    const response = await this._apiClient.listDatasources({
      params: { siteId },
      queries: { filter },
      ...this.authHeader,
    });
    return response.datasources.datasource ?? [];
  };
}
