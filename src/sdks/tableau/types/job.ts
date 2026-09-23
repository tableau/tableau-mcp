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

/** Async job returned by Run Flow Now / Run Flow Task. Use `runFlowJobType.flowRunId` to query its run. */
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

export const runFlowJobResponseSchema = z.object({
  job: runFlowJobSchema,
});
