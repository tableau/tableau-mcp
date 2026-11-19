import { z } from 'zod';

import { luidSchema } from '../../routeSafety/ids.js';

export const subscriptionContentTypeSchema = z.enum(['Workbook', 'View']);
export const subscriptionBooleanSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

const weekDaySchema = z.enum([
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]);
const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5][05]:00$/, 'Use HH:mm:00 on a five-minute boundary.');
const intervalSchema = z
  .object({
    hours: z.number().int().optional(),
    minutes: z.number().int().optional(),
    weekDay: weekDaySchema.optional(),
    monthDay: z
      .union([
        z.number().int().min(1).max(31),
        z.enum(['First', 'Second', 'Third', 'Fourth', 'Fifth', 'LastDay']),
      ])
      .optional(),
  })
  .strict();

/** Cloud subscription intervals differ from extract refresh intervals (notably Daily end). */
export const cloudSubscriptionScheduleSchema = z
  .object({
    frequency: z.enum(['Hourly', 'Daily', 'Weekly', 'Monthly']),
    frequencyDetails: z
      .object({
        start: timeSchema,
        end: timeSchema.optional(),
        intervals: z.object({ interval: z.array(intervalSchema).min(1).max(38) }).strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine(({ frequency, frequencyDetails: details }, ctx) => {
    const intervals = details.intervals.interval;
    const days = intervals.filter((interval) => interval.weekDay !== undefined);
    const hours = intervals.filter(
      (interval) => interval.hours !== undefined || interval.minutes !== undefined,
    );
    const months = intervals.filter((interval) => interval.monthDay !== undefined);
    const issue = (message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    };
    if (new Set(intervals.map((interval) => JSON.stringify(interval))).size !== intervals.length) {
      issue('Schedule intervals must be unique.');
    }
    if (intervals.some((interval) => Object.keys(interval).length === 0))
      issue('An interval cannot be empty.');
    if (frequency === 'Hourly' || frequency === 'Daily') {
      if (
        days.length === 0 ||
        months.length > 0 ||
        hours.length !== 1 ||
        intervals.some((interval) => Object.keys(interval).length !== 1)
      ) {
        issue('Hourly/Daily schedules require weekdays and exactly one hours/minutes interval.');
      }
      const cadence = hours[0];
      if (frequency === 'Hourly' && !(cadence?.hours === 1 || cadence?.minutes === 60))
        issue('Hourly cadence must be hours: 1 or minutes: 60.');
      if (
        frequency === 'Daily' &&
        (!cadence ||
          cadence.minutes !== undefined ||
          ![2, 4, 6, 8, 12, 24].includes(cadence.hours ?? 0))
      )
        issue('Daily hours must be 2, 4, 6, 8, 12, or 24.');
      if (frequency === 'Hourly' || cadence?.hours !== 24) {
        if (
          !details.end ||
          details.end <= details.start ||
          details.end.slice(3) !== details.start.slice(3)
        )
          issue('The end must follow the start by a whole number of hours.');
      } else if (details.end) issue('Omit end for a once-daily schedule.');
    } else if (frequency === 'Weekly') {
      if (
        intervals.length !== 1 ||
        days.length !== 1 ||
        Object.keys(intervals[0]).length !== 1 ||
        details.end
      )
        issue('Weekly schedules require exactly one weekday and no end.');
    } else {
      if (months.length !== intervals.length || hours.length || details.end)
        issue('Monthly schedules require monthDay intervals and no end.');
      if (months.some((interval) => typeof interval.monthDay === 'string')) {
        if (intervals.length !== 1)
          issue('An ordinal or LastDay monthly interval must stand alone.');
        if (months[0]?.monthDay !== 'LastDay' && !months[0]?.weekDay)
          issue('An ordinal monthly interval requires a weekday.');
      } else if (days.length) issue('Numeric monthly dates cannot include a weekday.');
    }
  });

export const subscriptionScheduleInputSchema = z.union([
  z.object({ id: luidSchema }).strict(),
  cloudSubscriptionScheduleSchema,
]);

// Only documented response fields leave this SDK; user names/email and arbitrary extras are stripped.
export const subscriptionScheduleSchema = z.object({
  id: luidSchema.optional(),
  name: z.string().optional(),
  frequency: z.string().optional(),
  nextRunAt: z.string().optional(),
  frequencyDetails: z
    .object({
      start: z.string().optional(),
      end: z.string().optional(),
      intervals: z
        .object({
          interval: z.array(
            z.object({
              hours: z.coerce.number().optional(),
              minutes: z.coerce.number().optional(),
              weekDay: z.string().optional(),
              monthDay: z.union([z.string(), z.number()]).optional(),
            }),
          ),
        })
        .optional(),
    })
    .optional(),
});
export const subscriptionSchema = z.object({
  id: luidSchema,
  subject: z.string(),
  suspended: subscriptionBooleanSchema,
  attachImage: subscriptionBooleanSchema.optional(),
  attachPdf: subscriptionBooleanSchema.optional(),
  message: z.string().optional(),
  pageOrientation: z.string().optional(),
  pageSizeOption: z.string().optional(),
  content: z.object({
    id: luidSchema,
    type: subscriptionContentTypeSchema,
    sendIfViewEmpty: subscriptionBooleanSchema.optional(),
  }),
  user: z.object({ id: luidSchema }),
  schedule: subscriptionScheduleSchema.optional(),
});

export const createSubscriptionInputSchema = z
  .object({
    contentType: subscriptionContentTypeSchema,
    contentId: luidSchema,
    subject: z.string().trim().min(1).max(255),
    schedule: subscriptionScheduleInputSchema,
    suspended: z.boolean().optional(),
    attachImage: z.boolean().optional(),
    attachPdf: z.boolean().optional(),
    message: z.string().max(10000).optional(),
    sendIfViewEmpty: z.boolean().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.attachImage === false && input.attachPdf !== true)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of attachImage or attachPdf must be enabled.',
      });
    if (input.contentType === 'Workbook' && input.sendIfViewEmpty !== undefined)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sendIfViewEmpty applies only to View subscriptions.',
      });
  });

export type Subscription = z.infer<typeof subscriptionSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionInputSchema>;
