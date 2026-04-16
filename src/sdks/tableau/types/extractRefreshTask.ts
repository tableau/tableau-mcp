import { z } from 'zod';

/**
 * Schedule info on an extract refresh task.
 * Tableau Server returns id, name, state, frequency, nextRunAt, etc.
 * Tableau Cloud returns frequency, nextRunAt, and optional frequencyDetails.
 */
export const extractRefreshScheduleSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  state: z.string().optional(),
  priority: z.coerce.number().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  type: z.string().optional(),
  frequency: z.string().optional(),
  nextRunAt: z.string().optional(),
  frequencyDetails: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
      intervals: z
        .object({
          interval: z
            .union([
              z.array(z.object({ weekDay: z.string().optional(), monthDay: z.union([z.string(), z.number()]).optional(), hours: z.number().optional(), minutes: z.number().optional() })),
              z.object({ weekDay: z.string().optional(), monthDay: z.union([z.string(), z.number()]).optional(), hours: z.number().optional(), minutes: z.number().optional() }),
            ])
            .optional(),
        })
        .optional(),
    })
    .optional(),
});

export type ExtractRefreshSchedule = z.infer<typeof extractRefreshScheduleSchema>;

export const extractRefreshTaskSchema = z.object({
  id: z.string(),
  priority: z.coerce.number().optional(),
  consecutiveFailedCount: z.coerce.number().optional(),
  type: z.string().optional(),
  schedule: extractRefreshScheduleSchema.optional(),
  datasource: z.object({ id: z.string() }).optional(),
  workbook: z.object({ id: z.string() }).optional(),
});

export type ExtractRefreshTask = z.infer<typeof extractRefreshTaskSchema>;
