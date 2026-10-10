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

const statusNoteSchema = z.object({
  type: z.string().optional(),
  value: z.string().optional(),
  text: z.string().optional(),
});

/**
 * Query Job response (`GET /sites/{siteId}/jobs/{jobId}`). `finishCode` is 0 (success), 1 (failed)
 * or 2 (cancelled) once the job completes, and absent while it is still running.
 */
export const jobDetailSchema = z.object({
  id: z.string(),
  mode: z.string().optional(),
  type: z.string().optional(),
  progress: z.coerce.number().optional(),
  createdAt: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  finishCode: z.coerce.number().optional(),
  notes: z
    .union([z.string(), z.array(z.string()).transform((notes) => notes.join('\n'))])
    .optional(),
  statusNotes: z
    .object({
      statusNote: z
        .union([z.array(statusNoteSchema), statusNoteSchema.transform((note) => [note])])
        .optional(),
    })
    .optional(),
});

export type JobDetail = z.infer<typeof jobDetailSchema>;

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
