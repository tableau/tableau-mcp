import { Zodios } from '@zodios/core';
import { Err, Ok, Result } from 'ts-results-es';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import {
  parseGetFlowRunTasksResponse,
  parseListExtractRefreshTasksResponse,
  tasksApis,
} from '../apis/tasksApi.js';
import { RestApiCredentials } from '../restApi.js';
import { parseTableauApiError } from '../tableauApiError.js';
import {
  ExtractRefreshTask,
  UpdateCloudExtractRefreshSchedule,
} from '../types/extractRefreshTask.js';
import { FlowRunTask } from '../types/flowRunTask.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Failure modes for {@link TasksMethods.updateCloudExtractRefreshTask}. The Tableau Cloud
 * "Update Cloud Extract Refresh Task" endpoint commonly rejects requests with `409004 Invalid
 * subscription schedule` plus a structured `error` object in the response body — surfacing that
 * structured info lets callers (e.g. an LLM driving the MCP tool) recover from validation
 * errors without reading raw axios stack traces. Mirrors `viewsMethods.QueryImageError`.
 */
export type UpdateCloudExtractRefreshTaskError =
  | { type: 'tableau-api'; status: number; code?: string; summary?: string; detail?: string }
  | { type: 'unknown'; message: string };

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
   * Required scopes (Tableau Cloud): `tableau:tasks:delete`
   *
   * @param siteId - The Tableau site ID
   * @param taskId - The extract refresh task ID to delete
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#delete_extract_refresh_task
   */
  deleteExtractRefreshTask = async ({
    siteId,
    taskId,
  }: {
    siteId: string;
    taskId: string;
  }): Promise<void> => {
    await this._apiClient.deleteExtractRefreshTask(undefined, {
      params: { siteId, taskId },
      ...this.authHeader,
    });
  };

  /**
   * Updates the schedule of an extract refresh task on Tableau Cloud (API 3.20+).
   *
   * The Tableau REST endpoint expects POST to /sites/{siteId}/tasks/extractRefreshes/{taskId}
   * with `extractRefresh` and `schedule` as siblings in the body. All body attributes are
   * optional; sending only `schedule` is sufficient to change the task's schedule. The response
   * also returns the two as siblings; this method merges them so callers receive a single
   * `ExtractRefreshTask` record with `schedule` populated, matching list-extract-refresh-tasks.
   *
   * Required scopes (Tableau Cloud): `tableau:tasks:write`
   *
   * @param siteId - The Tableau site ID
   * @param taskId - The extract refresh task ID to update
   * @param schedule - The new schedule (frequency + frequencyDetails)
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_extract_and_encryption.htm#update_cloud_extract_refresh_task
   */
  updateCloudExtractRefreshTask = async ({
    siteId,
    taskId,
    schedule,
  }: {
    siteId: string;
    taskId: string;
    schedule: UpdateCloudExtractRefreshSchedule;
  }): Promise<Result<ExtractRefreshTask, UpdateCloudExtractRefreshTaskError>> => {
    try {
      const response = await this._apiClient.updateCloudExtractRefreshTask(
        { schedule },
        {
          params: { siteId, taskId },
          ...this.authHeader,
        },
      );
      // The response schema is permissive — Cloud's exact payload varies by site and the
      // destructive e2e leg is gated. Fall back to the requested taskId/schedule so a
      // missing/partial response field doesn't turn a successful update into an Err.
      return new Ok({
        ...response.extractRefresh,
        id: response.extractRefresh?.id ?? taskId,
        schedule: response.schedule ?? response.extractRefresh?.schedule,
      });
    } catch (error) {
      const parsed = parseTableauApiError(error);
      if (parsed) {
        return new Err({ type: 'tableau-api', ...parsed });
      }
      return new Err({ type: 'unknown', message: getExceptionMessage(error) });
    }
  };

  /**
   * Returns the list of scheduled flow run tasks for the site.
   * Each task describes the schedule for a flow (frequency, next run time) plus
   * the flow it targets.
   *
   * Required scopes (Tableau Cloud): `tableau:flow_tasks:read`
   *
   * Permissions: non-administrators see only the scheduled flow run tasks for
   * flows they own; administrators see all flow run tasks on the site.
   *
   * @param siteId - The Tableau site ID
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_run_tasks
   */
  getFlowRunTasks = async ({ siteId }: { siteId: string }): Promise<FlowRunTask[]> => {
    const raw = await this._apiClient.getFlowRunTasks({
      params: { siteId },
      ...this.authHeader,
    });
    const response = parseGetFlowRunTasksResponse(raw);
    return response.tasks.task.map((t) => t.flowRun);
  };
}
