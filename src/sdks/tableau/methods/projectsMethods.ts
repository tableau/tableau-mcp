import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { projectsApis } from '../apis/projectsApi.js';
import { Credentials } from '../types/credentials.js';
import { Pagination } from '../types/pagination.js';
import { Project } from '../types/project.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Projects methods of the Tableau Server REST API
 *
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_projects.htm
 */
export default class ProjectsMethods extends AuthenticatedMethods<typeof projectsApis> {
  constructor(baseUrl: string, creds: Credentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, projectsApis, { axiosConfig }), creds);
  }

  private jsonHeaders(): AxiosRequestConfig {
    return {
      ...this.authHeader,
      headers: {
        ...this.authHeader.headers,
        Accept: 'application/json',
      },
    };
  }

  private jsonWriteHeaders(): AxiosRequestConfig {
    return {
      ...this.authHeader,
      headers: {
        ...this.authHeader.headers,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    };
  }

  /**
   * Returns a list of projects on the specified site.
   *
   * Required scopes: `tableau:content:read`
   */
  queryProjects = async ({
    siteId,
    filter,
    sort,
    pageSize,
    pageNumber,
    fields,
  }: {
    siteId: string;
    filter?: string;
    sort?: string;
    pageSize?: number;
    pageNumber?: number;
    fields?: string;
  }): Promise<{ pagination: Pagination; projects: Project[] }> => {
    const response = await this._apiClient.queryProjects({
      params: { siteId },
      queries: { filter, sort, pageSize, pageNumber, fields },
      ...this.jsonHeaders(),
    });
    return {
      pagination: response.pagination,
      projects: response.projects.project ?? [],
    };
  };

  /**
   * Creates a project on the specified site.
   *
   * Required scopes: `tableau:content:update` (or site-specific project create capability)
   */
  createProject = async ({ siteId, body }: { siteId: string; body: unknown }): Promise<unknown> =>
    await this._apiClient.createProject({
      params: { siteId },
      body,
      ...this.jsonWriteHeaders(),
    });

  /**
   * Updates the specified project.
   *
   * Required scopes: `tableau:content:update`
   */
  updateProject = async ({
    siteId,
    projectId,
    body,
  }: {
    siteId: string;
    projectId: string;
    body: unknown;
  }): Promise<unknown> =>
    await this._apiClient.updateProject({
      params: { siteId, projectId },
      body,
      ...this.jsonWriteHeaders(),
    });

  /**
   * Deletes the specified project.
   *
   * Required scopes: `tableau:content:delete`
   */
  deleteProject = async ({
    siteId,
    projectId,
  }: {
    siteId: string;
    projectId: string;
  }): Promise<unknown> =>
    await this._apiClient.deleteProject({
      params: { siteId, projectId },
      ...this.jsonHeaders(),
    });
}
