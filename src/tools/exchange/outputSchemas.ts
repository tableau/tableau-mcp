import { z } from 'zod';

export const assetTypeSchema = z.enum(['skill', 'extension', 'viz', 'connector', 'accelerator']);
export const tagSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  canonicalName: z.string(),
  type: z.string(),
  applicableProductType: assetTypeSchema.nullable(),
});
const detailsSchema = z.union([
  z
    .object({
      kind: z.literal('connector'),
      versionNumber: z.string().optional(),
      dataSourceClass: z.string().optional(),
      installationInstructions: z.string().optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal('accelerator'), connectionTypeDisplayName: z.string().optional() })
    .strict(),
  z
    .object({
      kind: z.enum(['extension', 'viz']),
      extensionUrl: z.string().url().optional(),
      publicExamples: z
        .array(z.object({ name: z.string(), url: z.string().url() }).strict())
        .optional(),
    })
    .strict(),
]);
export const assetSchema = z
  .object({
    id: z.number().int().positive(),
    type: assetTypeSchema,
    name: z.string(),
    shortDescription: z.string().max(600),
    publisher: z
      .object({ id: z.number().int().nonnegative().nullable(), name: z.string() })
      .strict(),
    tags: z.array(tagSchema),
    minimumTableauVersion: z.string().optional(),
    downloads: z.number().int().nonnegative().optional(),
    publishDate: z.string().optional(),
    iconUrl: z.string().url().optional(),
    pictureUrls: z.array(z.string().url()).optional(),
    supportUrl: z.string().url().optional(),
    privacyPolicyUrl: z.string().url().optional(),
    listingUrl: z.string().url(),
    communityContribution: z.boolean(),
    technicalMetadataStatus: z.enum(['unavailable', 'available']),
    detailedDescription: z.string().max(20_000).optional(),
    descriptionTruncated: z.boolean().optional(),
    details: detailsSchema.optional(),
  })
  .strict();
export const metaSchema = z
  .object({
    generatedAt: z.string(),
    catalogLoadedAt: z.string().nullable(),
    catalogAssetCount: z.number().int().nonnegative(),
    partialProductTypes: z.array(assetTypeSchema),
    missingProductTypes: z.array(assetTypeSchema),
    staleProductTypes: z.array(assetTypeSchema),
    source: z.enum(['gallery-api', 'declared-fixture']),
    cacheAgeSeconds: z.number().nonnegative().nullable(),
    stale: z.boolean(),
    warnings: z.array(z.string()),
  })
  .strict();
export const searchOutputSchema = {
  data: z
    .object({
      results: z
        .array(
          z
            .object({
              asset: assetSchema.omit({
                detailedDescription: true,
                descriptionTruncated: true,
                details: true,
              }),
              score: z.number(),
              reasons: z.array(z.string()),
              matchedFields: z.array(z.enum(['name', 'description', 'tag', 'publisher', 'type'])),
            })
            .strict(),
        )
        .max(10),
      totalMatches: z.number().int().nonnegative(),
    })
    .strict(),
  meta: metaSchema,
};
export const detailOutputSchema = { data: assetSchema, meta: metaSchema };
export const compareOutputSchema = {
  data: z
    .object({
      assets: z.array(assetSchema).min(2).max(4),
      dimensions: z
        .array(
          z
            .object({
              productId: z.number(),
              type: assetTypeSchema,
              publisher: z.string(),
              tags: z.array(z.string()),
              minimumTableauVersion: z.string().nullable(),
              downloads: z.number().nullable(),
              supportUrl: z.string().nullable(),
              communityContribution: z.boolean(),
            })
            .strict(),
        )
        .min(2)
        .max(4),
    })
    .strict(),
  meta: metaSchema,
};
export const categoryOutputSchema = {
  data: z
    .object({
      scope: z.literal('published-used'),
      groups: z.array(
        z
          .object({
            type: z.string(),
            tags: z.array(tagSchema.extend({ assetCount: z.number().int().positive() })),
          })
          .strict(),
      ),
    })
    .strict(),
  meta: metaSchema,
};
export const downloadOutputSchema = {
  data: z
    .object({
      productId: z.number().int().positive(),
      type: assetTypeSchema,
      name: z.string(),
      fileName: z.string(),
      path: z.string(),
      bytes: z.number().int().nonnegative(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      listingUrl: z.string().url(),
      nextStep: z.string(),
      installationInstructions: z.string().max(20_000).optional(),
    })
    .strict(),
  meta: metaSchema,
};
