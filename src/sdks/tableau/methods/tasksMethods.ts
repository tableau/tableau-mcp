import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { tasksApis } from '../apis/tasksApi.js';
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
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#list_extract_refresh_tasks_in_site
   */
  listExtractRefreshTasks = async ({ siteId }: { siteId: string }): Promise<ExtractRefreshTask[]> => {
    const response = await this._apiClient.listExtractRefreshTasks({
      params: { siteId },
      ...this.authHeader,
    });

    const tasks = response.tasks;
    if (Array.isArray(tasks)) {
      return tasks.map((t) => t.extractRefresh);
    }
    const task = tasks.task;
    if (Array.isArray(task)) {
      return task.map((t) => t.extractRefresh);
    }
    return task ? [task.extractRefresh] : [];
  };
}
