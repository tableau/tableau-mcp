import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { jobSchema } from '../types/job.js';
import { paginationSchema } from '../types/pagination.js';
import { paginationParameters } from './paginationParameters.js';

const listJobsResponseSchema = z.object({
  pagination: paginationSchema,
  backgroundJobs: z.union([
    z.object({
      backgroundJob: z.union([z.array(jobSchema), jobSchema.transform((job) => [job])]),
    }),
    z.object({}).transform(() => ({ backgroundJob: [] })),
  ]),
});

export type ListJobsResponse = z.infer<typeof listJobsResponseSchema>;

export function parseListJobsResponse(raw: unknown): ListJobsResponse {
  return listJobsResponseSchema.parse(raw);
}

/**
 * Query Jobs
 * GET /api/api-version/sites/site-id/jobs
 * Returns a list of active jobs on the specified site, including extract refreshes, subscriptions, and flows.
 * Tableau Cloud scope: tableau:jobs:read
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#query_jobs
 */
const listJobsEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/jobs',
  alias: 'listJobs',
  description:
    'Returns a list of background jobs on the specified site, including extract refreshes, subscriptions, and flows.',
  parameters: [
    ...paginationParameters,
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
    {
      name: 'filter',
      type: 'Query',
      schema: z.string().optional(),
      description:
        'Server-side filter expression. Supported fields: jobType, progress, createdAt, startedAt, endedAt, title, notes.',
    },
  ],
  response: listJobsResponseSchema,
});

const jobsApi = makeApi([listJobsEndpoint]);
export const jobsApis = [...jobsApi] as const satisfies ZodiosEndpointDefinitions;
