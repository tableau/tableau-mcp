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
              z.array(
                z.object({
                  weekDay: z.string().optional(),
                  monthDay: z.union([z.string(), z.number()]).optional(),
                  hours: z.coerce.number().optional(),
                  minutes: z.coerce.number().optional(),
                }),
              ),
              z.object({
                weekDay: z.string().optional(),
                monthDay: z.union([z.string(), z.number()]).optional(),
                hours: z.coerce.number().optional(),
                minutes: z.coerce.number().optional(),
              }),
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

/**
 * Tableau Cloud `update-cloud-extract-refresh-task` accepts a schedule with a frequency
 * (Hourly | Daily | Weekly | Monthly) and a frequencyDetails object describing the time
 * window and recurrence intervals. Stricter than the response schema: enum is closed and
 * intervals must be an array.
 */
export const updateCloudExtractRefreshScheduleSchema = z
  .object({
    frequency: z.enum(['Hourly', 'Daily', 'Weekly', 'Monthly']),
    frequencyDetails: z.object({
      start: z.string().describe('Start time in HH:mm:ss (24-hour) format, e.g. "06:00:00".'),
      end: z
        .string()
        .optional()
        .describe(
          'End time in HH:mm:ss (24-hour) format. Required for Hourly schedules; ignored for Daily/Weekly/Monthly.',
        ),
      intervals: z
        .object({
          interval: z.array(
            z.object({
              weekDay: z
                .enum([
                  'Sunday',
                  'Monday',
                  'Tuesday',
                  'Wednesday',
                  'Thursday',
                  'Friday',
                  'Saturday',
                ])
                .optional(),
              monthDay: z.string().optional(),
              hours: z.coerce.number().int().nonnegative().optional(),
              minutes: z.coerce.number().int().nonnegative().optional(),
            }),
          ),
        })
        .optional(),
    }),
  })
  .refine((s) => s.frequency !== 'Hourly' || s.frequencyDetails.end !== undefined, {
    message: 'frequencyDetails.end is required for Hourly schedules',
    path: ['frequencyDetails', 'end'],
  })
  .refine(
    (s) => {
      if (s.frequency !== 'Hourly' || s.frequencyDetails.end === undefined) return true;
      return s.frequencyDetails.start.slice(3) === s.frequencyDetails.end.slice(3);
    },
    {
      message:
        'For Hourly schedules, frequencyDetails.start and frequencyDetails.end must share the same minute and second portion (e.g. "06:00:00" / "18:00:00")',
      path: ['frequencyDetails', 'end'],
    },
  )
  .refine(
    (s) => {
      if (s.frequency !== 'Hourly' || s.frequencyDetails.end === undefined) return true;
      return s.frequencyDetails.end > s.frequencyDetails.start;
    },
    {
      message:
        'For Hourly schedules, frequencyDetails.end must be strictly after frequencyDetails.start',
      path: ['frequencyDetails', 'end'],
    },
  );

export type UpdateCloudExtractRefreshSchedule = z.infer<
  typeof updateCloudExtractRefreshScheduleSchema
>;

/**
 * Request body for `Update cloud extract refresh task`. Per the Tableau REST API,
 * `extractRefresh` and `schedule` are siblings at the top level — not nested. All attributes
 * are optional; sending only `schedule` is sufficient to change a task's schedule.
 */
export const updateCloudExtractRefreshTaskRequestSchema = z.object({
  extractRefresh: z
    .object({
      type: z.enum(['FullRefresh', 'IncrementalRefresh']).optional(),
    })
    .optional(),
  schedule: updateCloudExtractRefreshScheduleSchema,
});

/**
 * Response body shape for `Update cloud extract refresh task`. `extractRefresh` and `schedule`
 * are sibling top-level elements; the schedule is NOT nested inside extractRefresh on this endpoint.
 */
export const updateCloudExtractRefreshTaskResponseSchema = z.object({
  extractRefresh: extractRefreshTaskSchema,
  schedule: extractRefreshScheduleSchema,
});
