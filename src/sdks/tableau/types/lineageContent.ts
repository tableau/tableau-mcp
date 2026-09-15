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

export const lineageContentSchema = z.object({
  luid: z.string(),
  name: z.string(),
  datasourceType: z.enum(['published', 'embedded']).optional(),
  publishedParent: publishedParentSchema.optional(),
});

export type LineageContent = z.infer<typeof lineageContentSchema>;
