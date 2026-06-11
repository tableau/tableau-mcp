import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { jobsApis, parseListJobsResponse } from '../apis/jobsApi.js';
import { RestApiCredentials } from '../restApi.js';
import { Job } from '../types/job.js';
import { Pagination } from '../types/pagination.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Jobs methods of the Tableau Server REST API
 *
 * @export
 * @class JobsMethods
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm
 */
export default class JobsMethods extends AuthenticatedMethods<typeof jobsApis> {
  constructor(baseUrl: string, creds: RestApiCredentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, jobsApis, { axiosConfig }), creds);
  }

  /**
   * Returns a list of background jobs on the specified site.
   *
   * Required scopes (Tableau Cloud): `tableau:jobs:read`
   *
   * @param siteId - The Tableau site ID
   * @param filter - Server-side filter string (e.g. "jobType:eq:refresh_extracts")
   * @param pageSize - The number of items to return in one response
   * @param pageNumber - The offset for paging
   * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#query_jobs
   */
  listJobs = async ({
    siteId,
    filter,
    pageSize,
    pageNumber,
  }: {
    siteId: string;
    filter?: string;
    pageSize?: number;
    pageNumber?: number;
  }): Promise<{ pagination: Pagination; jobs: Job[] }> => {
    const raw = await this._apiClient.listJobs({
      params: { siteId },
      queries: { filter, pageSize, pageNumber },
      ...this.authHeader,
    });
    const response = parseListJobsResponse(raw);
    const jobs = 'backgroundJob' in response.backgroundJobs
      ? response.backgroundJobs.backgroundJob
      : [];
    return {
      pagination: response.pagination,
      jobs,
    };
  };
}
