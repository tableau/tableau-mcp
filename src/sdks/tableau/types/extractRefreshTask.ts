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
 * window and recurrence intervals.
 *
 * The schema enforces what we know upfront so an LLM driving the tool gets immediate
 * feedback instead of a 409004 round-trip:
 *   - times are zero-padded HH:mm:ss
 *   - minute/second portions are on a 5-minute boundary
 *   - Hourly: end is required, end.minutes match start, end > start (numeric)
 *   - Weekly: at least one weekDay interval; Monthly: at least one monthDay interval
 */
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/;
const TIME_FORMAT_HINT = 'must be in zero-padded HH:mm:ss 24-hour format, e.g. "06:00:00"';

const timeStringSchema = z.string().regex(TIME_REGEX, `time ${TIME_FORMAT_HINT}`);

function timeToSeconds(t: string): number {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + s;
}

function isFiveMinuteBoundary(t: string): boolean {
  const [, , minutes, seconds] = t.match(TIME_REGEX) ?? [];
  return (
    minutes !== undefined &&
    seconds !== undefined &&
    Number(minutes) % 5 === 0 &&
    Number(seconds) === 0
  );
}

export const updateCloudExtractRefreshScheduleSchema = z
  .object({
    frequency: z.enum(['Hourly', 'Daily', 'Weekly', 'Monthly']),
    frequencyDetails: z.object({
      start: timeStringSchema.describe('Start time in HH:mm:ss (24-hour) format, e.g. "06:00:00".'),
      end: timeStringSchema
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
  .refine((s) => isFiveMinuteBoundary(s.frequencyDetails.start), {
    message:
      'frequencyDetails.start minute portion must be on a 5-minute boundary (00, 05, 10, ..., 55) with seconds = 00',
    path: ['frequencyDetails', 'start'],
  })
  .refine(
    (s) => s.frequencyDetails.end === undefined || isFiveMinuteBoundary(s.frequencyDetails.end),
    {
      message:
        'frequencyDetails.end minute portion must be on a 5-minute boundary (00, 05, 10, ..., 55) with seconds = 00',
      path: ['frequencyDetails', 'end'],
    },
  )
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
      return timeToSeconds(s.frequencyDetails.end) > timeToSeconds(s.frequencyDetails.start);
    },
    {
      message:
        'For Hourly schedules, frequencyDetails.end must be strictly after frequencyDetails.start',
      path: ['frequencyDetails', 'end'],
    },
  )
  .refine(
    (s) => {
      if (s.frequency !== 'Weekly') return true;
      return s.frequencyDetails.intervals?.interval.some((i) => i.weekDay !== undefined) ?? false;
    },
    {
      message:
        'Weekly schedules require at least one frequencyDetails.intervals.interval entry with a weekDay',
      path: ['frequencyDetails', 'intervals'],
    },
  )
  .refine(
    (s) => {
      if (s.frequency !== 'Monthly') return true;
      return s.frequencyDetails.intervals?.interval.some((i) => i.monthDay !== undefined) ?? false;
    },
    {
      message:
        'Monthly schedules require at least one frequencyDetails.intervals.interval entry with a monthDay',
      path: ['frequencyDetails', 'intervals'],
    },
  );

export type UpdateCloudExtractRefreshSchedule = z.infer<
  typeof updateCloudExtractRefreshScheduleSchema
>;

/**
 * Request body for `Update cloud extract refresh task`. Per the Tableau REST API the body
 * carries just the schedule; the tool does not yet expose a way to flip extractRefresh.type
 * (FullRefresh|IncrementalRefresh), so it is omitted to avoid advertising a capability the
 * tool doesn't offer.
 */
export const updateCloudExtractRefreshTaskRequestSchema = z.object({
  schedule: updateCloudExtractRefreshScheduleSchema,
});

/**
 * Response body shape for `Update cloud extract refresh task`. `extractRefresh` and `schedule`
 * are sibling top-level elements (the schedule is NOT nested inside extractRefresh). All fields
 * are tolerated optional/partial because the Cloud endpoint's exact response payload varies
 * by site and is hard to lock down without the destructive e2e leg gated behind
 * UPDATE_CLOUD_EXTRACT_REFRESH_TASK_E2E_ID. The wrapping method falls back to the requested
 * taskId/schedule when the response omits them, so a missing field doesn't turn a successful
 * update into a Result Err.
 */
export const updateCloudExtractRefreshTaskResponseSchema = z.object({
  extractRefresh: extractRefreshTaskSchema.partial().optional(),
  schedule: extractRefreshScheduleSchema.optional(),
});
