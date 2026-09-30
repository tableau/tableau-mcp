import { z } from 'zod';

import { extractRefreshScheduleSchema } from './extractRefreshTask.js';

/**
 * A scheduled flow run task as returned by "Get Flow Run Tasks"
 * (GET /sites/:siteId/tasks/runFlow).
 *
 * This is the *schedule* for a flow (when/how often it is configured to run),
 * NOT a record of an individual execution — that is a flow run (see
 * {@link FlowRun}). Each task is keyed by the flow run task id (the `id` below),
 * which the "Run Flow Now" endpoint consumes as its `task-id`.
 *
 * The schedule sub-object has the same shape Tableau returns for extract refresh
 * tasks, so we reuse {@link extractRefreshScheduleSchema} rather than duplicate it.
 */
export const flowRunTaskSchema = z.object({
  id: z.string(),
  priority: z.coerce.number().optional(),
  consecutiveFailedCount: z.coerce.number().optional(),
  type: z.string().optional(),
  schedule: extractRefreshScheduleSchema.optional(),
  flow: z
    .object({
      id: z.string(),
      name: z.string().optional(),
    })
    .optional(),
});

export type FlowRunTask = z.infer<typeof flowRunTaskSchema>;
