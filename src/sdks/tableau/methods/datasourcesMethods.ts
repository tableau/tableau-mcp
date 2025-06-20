import { Zodios } from '@zodios/core';
import path from 'path';

import { Datasource, datasourcesApis, throwIfPublishFailed } from '../apis/datasourcesApi.js';
import { usePostMultipartPluginAsync } from '../plugins/postMultipartPlugin.js';
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

  /**
   * Publishes a data source on the specified site.
   *
   * @param {string} pathToDataSourceFile The path to the data source file to publish.
   * @param {string} siteId - The Tableau site ID
   * @param {string} projectId The id of the project to which to publish.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_data_sources.htm#publish_data_source
   */
  publishDataSource = async (
    pathToDataSourceFile: string,
    siteId: string,
    projectId: string,
  ): Promise<void> => {
    const dataSourceNameWithoutExtension = path.parse(pathToDataSourceFile).name;
    const datasource = {
      name: dataSourceNameWithoutExtension,
      project: { id: projectId },
    };

    await usePostMultipartPluginAsync({
      apiClient: this._apiClient,
      actionFnAsync: async () => {
        await this._apiClient.publishWorkbook(
          {
            contentDispositionName: 'tableau_datasource',
            asset: { datasource },
            pathToFile: pathToDataSourceFile,
          },
          {
            params: { siteId },
            ...this.authAndMultipartRequestHeaders,
          },
        );
      },
      catchFn: (e) => {
        throwIfPublishFailed(e, dataSourceNameWithoutExtension);
      },
    });
  };
}
