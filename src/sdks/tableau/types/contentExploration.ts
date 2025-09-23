import { z } from 'zod';

const orderingMethods = z.enum([
  'hitsTotal',
  'hitsSmallSpanTotal',
  'hitsMediumSpanTotal',
  'hitsLargeSpanTotal',
  'downstreamWorkbookCount',
]);

export const orderBySchema = z
  .array(
    z.object({
      method: orderingMethods,
      sortDirection: z.enum(['asc', 'desc']).default('asc').optional(),
    }),
  )
  .nonempty();

export type OrderBy = z.infer<typeof orderBySchema>;

const contentTypes = z.enum([
  'lens',
  'datasource',
  'virtualconnection',
  'collection',
  'project',
  'flow',
  'datarole',
  'table',
  'database',
  'view',
  'workbook',
]);

const modifiedTimeSchema = z.union([
  z.array(z.string().datetime()).nonempty(),
  z
    .object({
      startDate: z.string().datetime(),
      endDate: z.string().datetime().optional(),
    })
    .strict(),
  z
    .object({
      startDate: z.string().datetime().optional(),
      endDate: z.string().datetime(),
    })
    .strict(),
]);

export const searchContentFilterBase = z.object({
  contentTypes: z.array(contentTypes).nonempty().optional(),
  ownerIds: z.array(z.number().int()).nonempty().optional(),
  modifiedTime: modifiedTimeSchema.optional(),
});

export const searchContentFilterSchema = z.union([
  searchContentFilterBase.extend({ contentTypes: z.array(contentTypes).nonempty() }).strict(),
  searchContentFilterBase.extend({ ownerIds: z.array(z.number().int()).nonempty() }).strict(),
  searchContentFilterBase.extend({ modifiedTime: modifiedTimeSchema }).strict(),
]);

export type SearchContentFilter = z.infer<typeof searchContentFilterSchema>;

const searchContentItemSchema = z.object({
  uri: z.string(),
  content: z.record(z.string(), z.unknown()),
});

export const searchContentResponseSchema = z.object({
  next: z.string().optional(),
  prev: z.string().optional(),
  pageIndex: z.number().int().optional(),
  startIndex: z.number().int().optional(),
  total: z.number().int().optional(),
  limit: z.number().int().optional(),
  items: z.array(searchContentItemSchema).optional(),
});

export type SearchContentItem = z.infer<typeof searchContentItemSchema>;

export type SearchContentResponse = z.infer<typeof searchContentResponseSchema>;
