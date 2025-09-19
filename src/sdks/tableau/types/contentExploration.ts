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

export const SearchContentFilterBase = z.object({
  contentTypes: z.array(ContentTypes).nonempty().optional(),
  ownerIds: z.array(z.string()).nonempty().optional(),
  modifiedTime: z
    .array(
      z.object({
        operator: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']),
        value: z.date(),
      }),
    )
    .nonempty()
    .optional(),
});

export const SearchContentFilterSchema = z.union([
  SearchContentFilterBase.extend({ contentTypes: z.array(ContentTypes).nonempty() }).strict(),
  SearchContentFilterBase.extend({ ownerIds: z.array(z.string()).nonempty() }).strict(), // TODO: Is the empty string allowed for ownerIds?
  SearchContentFilterBase.extend({
    modifiedTime: z
      .array(
        z.object({
          operator: z.enum(['eq', 'gt', 'gte', 'lt', 'lte']),
          value: z.date(),
        }),
      )
      .nonempty(),
  }).strict(),
]);

export type SearchContentFilter = z.infer<typeof SearchContentFilterSchema>;

// TODO: Does this need to be a partial object?
export const SearchContentResponseSchema = z.object({
  next: z.string(),
  prev: z.string(),
  pageIndex: z.number().int().min(0),
  startIndex: z.number().int().min(0),
  total: z.number().int().max(2000),
  limit: z.number().int().max(2000),
  items: z.array(
    z.object({
      uri: z.string(),
      content: z.object({}),
    }),
  ), // TODO: does this schema work?
});

export type SearchContentResponse = z.infer<typeof SearchContentResponseSchema>;
