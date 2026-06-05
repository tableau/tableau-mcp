import { z } from 'zod';

import { extractRefreshScheduleSchema } from './extractRefreshTask.js';

/**
 * A distinct schedule aggregated from the site's extract refresh tasks.
 *
 * Tableau Cloud does not expose a standalone "schedules" collection - the
 * `GET /sites/{siteId}/schedules` and server-level `GET /schedules` endpoints
 * are Tableau Server only. On Cloud, schedule information is only available
 * embedded in each task's `schedule` object. This tool therefore derives the
 * schedule universe by aggregating the distinct schedules referenced by the
 * site's extract refresh tasks.
 *
 * The base fields mirror {@link extractRefreshScheduleSchema}; the `taskCount`,
 * `datasourceIds`, and `workbookIds` fields are aggregation metadata describing
 * which tasks share the schedule.
 */
export const scheduleSchema = extractRefreshScheduleSchema.extend({
  /** Number of extract refresh tasks that run on this schedule. */
  taskCount: z.number(),
  /** Distinct data source IDs whose extract refresh tasks use this schedule. */
  datasourceIds: z.array(z.string()).optional(),
  /** Distinct workbook IDs whose extract refresh tasks use this schedule. */
  workbookIds: z.array(z.string()).optional(),
});

export type Schedule = z.infer<typeof scheduleSchema>;
