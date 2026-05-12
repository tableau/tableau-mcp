import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { projectsApis } from '../apis/projectsApi.js';
import { RestApiCredentials } from '../restApi.js';
import { Pagination } from '../types/pagination.js';
import { Project } from '../types/project.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Projects methods of the Tableau Server REST API
 *
 * @export
 * @class ProjectsMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm
 */
export default class ProjectsMethods extends AuthenticatedMethods<typeof projectsApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, projectsApis, { axiosConfig }), creds);
  }

  /**
   * Returns a list of projects on the specified site.
   *
   * Required scopes: `tableau:projects:read`
   *
   * @param siteId - The Tableau site ID
   * @param filter - The filter string to filter projects by
   * @param pageSize - The number of items to return in one response. The minimum is 1. The maximum is 1000. The default is 100.
   * @param pageNumber - The offset for paging. The default is 1.
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm#query_projects
   */
  queryProjects = async ({
    siteId,
    filter,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    filter: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<{ pagination: Pagination; projects: Project[] }> => {
    const response = await this._apiClient.queryProjects({
      params: { siteId },
      queries: { filter, pageSize, pageNumber },
      ...this.authHeader,
    });
    return {
      pagination: response.pagination,
      projects: response.projects.project ?? [],
    };
  };
}
