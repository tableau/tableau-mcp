import { z } from 'zod';

// Shared output shape for upstream-datasource references emitted by workbook/view/search-content
// tools. datasourceType and publishedParent are additive/optional so existing consumers that only
// read { luid, name } are unaffected. This is the emitted shape, not the lenient Metadata-API
// wire-parse schema in lineageUtils.ts.
export const publishedParentSchema = z.object({
  luid: z.string(),
  name: z.string(),
});

export type PublishedParent = z.infer<typeof publishedParentSchema>;

// Whether the calling user can query this data source with the query-datasource tool; `reason`
// explains a false verdict. The whole object is omitted when queryability could not be determined.
export const queryabilitySchema = z.object({
  isQueryable: z.boolean(),
  reason: z.string().optional(),
});

export type Queryability = z.infer<typeof queryabilitySchema>;

export const lineageContentSchema = z.object({
  luid: z.string(),
  name: z.string(),
  datasourceType: z.enum(['published', 'embedded']).optional(),
  queryability: queryabilitySchema.optional(),
  publishedParent: publishedParentSchema.optional(),
});

export type LineageContent = z.infer<typeof lineageContentSchema>;
