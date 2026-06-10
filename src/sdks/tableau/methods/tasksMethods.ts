import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { parseListExtractRefreshTasksResponse, tasksApis } from '../apis/tasksApi.js';
import { RestApiCredentials } from '../restApi.js';
import { ExtractRefreshTask } from '../types/extractRefreshTask.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Jobs, tasks, and schedules methods of the Tableau Server REST API
 *
 * @export
 * @class TasksMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm
 */
export default class TasksMethods extends AuthenticatedMethods<typeof tasksApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, tasksApis, { axiosConfig }), creds);
  }

  /**
   * Returns a list of extract refresh tasks for the site.
   * Each task is for a data source or workbook extract and includes schedule information.
   *
   * Required scopes (Tableau Cloud): `tableau:tasks:read`
   *
   * @param siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#list_extract_refresh_tasks
   */
  listExtractRefreshTasks = async ({
    siteId,
  }: {
    siteId: string;
  }): Promise<ExtractRefreshTask[]> => {
    const raw = await this._apiClient.listExtractRefreshTasks({
      params: { siteId },
      ...this.authHeader,
    });
    const response = parseListExtractRefreshTasksResponse(raw);
    return response.tasks.task.map((t) => t.extractRefresh);
  };

  /**
   * Deletes an extract refresh task from the site.
   *
   * Required scopes (Tableau Cloud): `tableau:tasks:write`
   *
   * @param siteId - The Tableau site ID
   * @param taskId - The extract refresh task ID to delete
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#delete_extract_refresh_task
   */
  deleteExtractRefreshTask = async ({
    siteId,
    taskId,
  }: {
    siteId: string;
    taskId: string;
  }): Promise<void> => {
    await this._apiClient.deleteExtractRefreshTask({
      params: { siteId, taskId },
      ...this.authHeader,
    });
  };
}
