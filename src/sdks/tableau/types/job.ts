import { z } from 'zod';

export const jobSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
  jobType: z.string().optional(),
  priority: z.coerce.number().optional(),
  createdAt: z.string().optional(),
  startedAt: z.string().optional(),
  endedAt: z.string().optional(),
  progress: z.coerce.number().optional(),
  title: z.string().optional(),
});

export type Job = z.infer<typeof jobSchema>;

/**
 * The async background `job` Tableau returns from "Run Flow Now" and
 * "Run Flow Task" (both return `type="RunFlow"`).
 *
 * A flow run is NOT synchronous: these endpoints enqueue the run on the
 * backgrounder and immediately return this job envelope. The caller polls the
 * outcome separately — `runFlowJobType.flowRunId` is the flow run id that
 * `get-flow` / `list-flow-runs` report status for, and `id` is the background
 * job id (usable with the Query Job REST method).
 *
 * Shape (XML → JSON):
 * `<job id mode type createdAt><runFlowJobType flowRunId><flow id name/></job>`
 */
export const runFlowJobSchema = z.object({
  id: z.string(),
  mode: z.string().optional(),
  type: z.string().optional(),
  createdAt: z.string().optional(),
  runFlowJobType: z
    .object({
      flowRunId: z.string().optional(),
      flow: z
        .object({
          id: z.string(),
          name: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type RunFlowJob = z.infer<typeof runFlowJobSchema>;

/**
 * Tableau wraps the job in `{ job: {...} }`. Used as the Zodios endpoint
 * `response` schema for Run Flow Now / Run Flow Task, so Zodios validates the
 * shape at the SDK boundary (the methods then read `.job` directly).
 */
export const runFlowJobResponseSchema = z.object({
  job: runFlowJobSchema,
});
