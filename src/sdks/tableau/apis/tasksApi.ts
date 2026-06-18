import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { extractRefreshTaskSchema } from '../types/extractRefreshTask.js';
import { flowRunTaskSchema } from '../types/flowRunTask.js';

const taskEntrySchema = z.object({
  extractRefresh: extractRefreshTaskSchema,
});

const flowRunTaskEntrySchema = z.object({
  flowRun: flowRunTaskSchema,
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
      task: z.union([z.array(taskEntrySchema), taskEntrySchema.transform((task) => [task])]),
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

/**
 * Tableau API response schema for "Get Flow Run Tasks", normalized the same way
 * as {@link listExtractRefreshTasksBodySchema}:
 * - `{ tasks: { task: [...] } }` → as-is
 * - `{ tasks: { task: {...} } }` → wrapped in an array
 * - `{ tasks: [...] }` → normalized to `{ tasks: { task: [...] } }`
 * - `{ tasks: {} }` → normalized to `{ tasks: { task: [] } }`
 */
const getFlowRunTasksBodySchema = z.object({
  tasks: z.union([
    z.object({
      task: z.union([
        z.array(flowRunTaskEntrySchema),
        flowRunTaskEntrySchema.transform((task) => [task]),
      ]),
    }),
    z.array(flowRunTaskEntrySchema).transform((tasks) => ({ task: tasks })),
    z.object({}).transform(() => ({ task: [] })),
  ]),
});

export type GetFlowRunTasksBody = z.infer<typeof getFlowRunTasksBodySchema>;

/** Parse response using Zod schema with built-in transforms for normalization. */
export function parseGetFlowRunTasksResponse(raw: unknown): GetFlowRunTasksBody {
  return getFlowRunTasksBodySchema.parse(raw);
}

/**
 * Get Flow Run Tasks
 * GET /api/api-version/sites/site-id/tasks/runFlow
 * Returns the list of scheduled flow run tasks for the site. Each task describes
 * the schedule for a flow (frequency, next run time) plus the flow it targets.
 * Tableau Cloud scope: tableau:flow_tasks:read
 * @see https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_flow.htm#get_flow_run_tasks
 */
const getFlowRunTasksEndpoint = makeEndpoint({
  method: 'get',
  path: '/sites/:siteId/tasks/runFlow',
  alias: 'getFlowRunTasks',
  description:
    'Returns the list of scheduled flow run tasks for the site. Each task includes the flow it targets and schedule information (frequency, next run time).',
  parameters: [
    {
      name: 'siteId',
      type: 'Path',
      schema: z.string(),
    },
  ],
  response: getFlowRunTasksBodySchema,
});

const tasksApi = makeApi([listExtractRefreshTasksEndpoint, getFlowRunTasksEndpoint]);
export const tasksApis = [...tasksApi] as const satisfies ZodiosEndpointDefinitions;
