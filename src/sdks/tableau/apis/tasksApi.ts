import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { extractRefreshTaskSchema } from '../types/extractRefreshTask.js';

const taskEntrySchema = z.object({
  extractRefresh: extractRefreshTaskSchema,
});

/**
 * Tableau API response schema with transform to normalize different response shapes:
 * - `{ tasks: { task: [...] } }` → normalized to `{ tasks: { task: [...] } }`
 * - `{ tasks: { task: {...} } }` → normalized to `{ tasks: { task: [{...}] } }`
 * - `{ tasks: [...] }` → normalized to `{ tasks: { task: [...] } }`
 * - `{ tasks: {} }` → normalized to `{ tasks: { task: [] } }`
 */
const listExtractRefreshTasksBodySchema = z.object({
  tasks: z.union([
    z.object({
      task: z.union([
        z.array(taskEntrySchema),
        taskEntrySchema.transform((task) => [task]),
      ]),
    }),
    z.array(taskEntrySchema).transform((tasks) => ({ task: tasks })),
    z.object({}).transform(() => ({ task: [] })),
  ]),
});

export type ListExtractRefreshTasksBody = z.infer<typeof listExtractRefreshTasksBodySchema>;

/** Parse response using Zod schema with built-in transforms for normalization. */
export function parseListExtractRefreshTasksResponse(raw: unknown): ListExtractRefreshTasksBody {
  return listExtractRefreshTasksBodySchema.parse(raw);
}

/**
 * List Extract Refresh Tasks in Site
 * GET /api/api-version/sites/site-id/tasks/extractRefreshes
 * Returns a list of extract refresh tasks for the site (datasource and workbook extracts).
 * Tableau Cloud scope: tableau:tasks:read
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_jobs_tasks_and_schedules.htm#list_extract_refresh_tasks_in_site
 */
const listExtractRefreshTasksEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/tasks/extractRefreshes',
  alias: 'listExtractRefreshTasks',
  description:
    'Returns a list of extract refresh tasks for the site. Each task is for a data source or workbook extract and includes schedule information (frequency, next run time).',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: listExtractRefreshTasksBodySchema,
});

const tasksApi = makeApi([listExtractRefreshTasksEndpoint]);
export const tasksApis = [...tasksApi] as const satisfies ZodiosEndpointDefinitions;
