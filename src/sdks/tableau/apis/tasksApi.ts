import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

import { extractRefreshTaskSchema } from '../types/extractRefreshTask.js';

const taskEntrySchema = z.object({
  extractRefresh: extractRefreshTaskSchema,
});

const listExtractRefreshTasksBodySchema = z.object({
  tasks: z.union([
    z.object({ task: z.union([z.array(taskEntrySchema), taskEntrySchema]) }),
    z.array(taskEntrySchema),
  ]),
});

/**
 * Tableau returns `tasks: {}` when there are no extract refresh tasks. Normalize before Zod
 * validates so the response matches the documented `{ tasks: { task: ... } }` shape.
 */
export function normalizeListExtractRefreshTasksResponse(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') {
    return raw;
  }
  const data = raw as Record<string, unknown>;
  const tasks = data.tasks;
  if (tasks && typeof tasks === 'object' && !Array.isArray(tasks) && !('task' in tasks)) {
    return { ...data, tasks: { ...tasks, task: [] } };
  }
  return raw;
}

/** Same as {@link listExtractRefreshTasksBodySchema}; use with {@link normalizeListExtractRefreshTasksResponse} when testing raw API payloads. */
export const listExtractRefreshTasksResponseSchema = listExtractRefreshTasksBodySchema;

export type ListExtractRefreshTasksBody = z.infer<typeof listExtractRefreshTasksBodySchema>;

/** Normalize then parse; use this instead of relying on Zodios response validation (Tableau may return `tasks: {}`). */
export function parseListExtractRefreshTasksResponse(raw: unknown): ListExtractRefreshTasksBody {
  return listExtractRefreshTasksBodySchema.parse(normalizeListExtractRefreshTasksResponse(raw));
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
  // Do not validate with Zodios here — Tableau returns `tasks: {}` with no `task` key; we parse in {@link parseListExtractRefreshTasksResponse}.
  response: z.any(),
});

const tasksApi = makeApi([listExtractRefreshTasksEndpoint]);
export const tasksApis = [...tasksApi] as const satisfies ZodiosEndpointDefinitions;
