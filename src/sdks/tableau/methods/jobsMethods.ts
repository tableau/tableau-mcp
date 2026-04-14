import { Zodios } from '@zodios/core';

import { AxiosRequestConfig } from '../../../utils/axios.js';
import { jobsApis } from '../apis/jobsApi.js';
import { Credentials } from '../types/credentials.js';
import AuthenticatedMethods from './authenticatedMethods.js';

/**
 * Jobs — Query Jobs, Query Job, Cancel Job (PUT).
 *
 * @link https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm
 */
export default class JobsMethods extends AuthenticatedMethods<typeof jobsApis> {
  constructor(baseUrl: string, creds: Credentials, axiosConfig: AxiosRequestConfig) {
    super(new Zodios(baseUrl, jobsApis, { axiosConfig }), creds);
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

  queryJobs = async (
    siteId: string,
    queries?: { filter?: string; pageSize?: number; pageNumber?: number },
  ): Promise<unknown> =>
    (
      await this._apiClient.axios.get(`/sites/${siteId}/jobs`, {
        ...this.jsonHeaders(),
        params: queries,
      })
    ).data;

  queryJob = async (siteId: string, jobId: string): Promise<unknown> =>
    (await this._apiClient.axios.get(`/sites/${siteId}/jobs/${jobId}`, this.jsonHeaders())).data;

  /** Cancel Job — HTTP PUT (not DELETE). */
  cancelJob = async (siteId: string, jobId: string): Promise<unknown> =>
    (
      await this._apiClient.axios.put(`/sites/${siteId}/jobs/${jobId}`, undefined, {
        ...this.jsonHeaders(),
      })
    ).data;
}
