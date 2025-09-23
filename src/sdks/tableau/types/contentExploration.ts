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

export const searchContentFilterBase = z
  .object({
    contentTypes: z.array(contentTypes).nonempty(),
    ownerIds: z.array(z.number().int()).nonempty(),
    modifiedTime: modifiedTimeSchema,
  })
  .partial();

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

export const searchContentResponseSchema = z
  .object({
    next: z.string(),
    prev: z.string(),
    pageIndex: z.number().int(),
    startIndex: z.number().int(),
    total: z.number().int(),
    limit: z.number().int(),
    items: z.array(searchContentItemSchema),
  })
  .partial();

export type SearchContentItem = z.infer<typeof searchContentItemSchema>;

export type SearchContentResponse = z.infer<typeof searchContentResponseSchema>;
