import { z } from 'zod';

const OrderingMethods = z.enum([
  'hitsTotal',
  'hitsSmallSpanTotal',
  'hitsMediumSpanTotal',
  'hitsLargeSpanTotal',
  'downstreamWorkbookCount',
]);

export const OrderBySchema = z
  .array(
    z.object({
      method: OrderingMethods,
      sortDirection: z.enum(['asc', 'desc']).default('asc').optional(),
    }),
  )
  .nonempty();

export type OrderBy = z.infer<typeof OrderBySchema>;

const ContentTypes = z.enum([
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

const ModifiedTimeSchema = z.union([
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

export const SearchContentFilterBase = z.object({
  contentTypes: z.array(ContentTypes).nonempty().optional(),
  ownerIds: z.array(z.string()).nonempty().optional(),
  modifiedTime: ModifiedTimeSchema.optional(),
});

export const SearchContentFilterSchema = z.union([
  SearchContentFilterBase.extend({ contentTypes: z.array(ContentTypes).nonempty() }).strict(),
  SearchContentFilterBase.extend({ ownerIds: z.array(z.string()).nonempty() }).strict(), // TODO: Fix ownerIds schema
  SearchContentFilterBase.extend({ modifiedTime: ModifiedTimeSchema }).strict(),
]);

export type SearchContentFilter = z.infer<typeof SearchContentFilterSchema>;

const SearchContentItemSchema = z.object({
  uri: z.string(),
  content: z.record(z.string(), z.unknown()),
});

export const SearchContentResponseSchema = z.object({
  next: z.string().optional(),
  prev: z.string().optional(),
  pageIndex: z.number().int().optional(),
  startIndex: z.number().int().optional(),
  total: z.number().int().optional(),
  limit: z.number().int().optional(),
  items: z.array(SearchContentItemSchema).optional(),
});

export type SearchContentItem = z.infer<typeof SearchContentItemSchema>;

export type SearchContentResponse = z.infer<typeof SearchContentResponseSchema>;
