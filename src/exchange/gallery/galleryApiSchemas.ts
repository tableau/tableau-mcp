import { z } from 'zod';

export const galleryAssetTypeSchema = z.enum([
  'skill',
  'extension',
  'viz',
  'connector',
  'accelerator',
]);

const optionalText = z.string().max(200_000).nullish().catch(undefined);
const optionalNumber = z.number().int().nonnegative().nullish().catch(undefined);

export const galleryTagSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().max(1_000),
  canonicalName: z.string().min(1).max(1_000),
  type: z.string().min(1).max(100),
  applicableProductType: galleryAssetTypeSchema.nullable(),
});

const galleryDetailsSchema = z.object({
  version_number: optionalText,
  data_source_class: optionalText,
  installation_instructions: optionalText,
  connection_type_display_name: optionalText,
  extension_url: optionalText,
  public_examples: z
    .array(z.object({ name: optionalText, url: optionalText }))
    .max(1_000)
    .nullish()
    .catch(undefined),
});

export const galleryProductSchema = z.object({
  id: z.number().int().positive(),
  product_type: galleryAssetTypeSchema,
  name: z.string().min(1).max(10_000),
  short_description: optionalText,
  detailed_description: optionalText,
  publisher_name: z.string().max(10_000),
  publisher_id: optionalNumber,
  typed_tags: z.array(galleryTagSchema).max(200),
  minimum_tableau_version: optionalText,
  downloads: optionalNumber,
  publish_date: optionalText,
  product_icon_url: optionalText,
  pictures: z.array(z.string().max(10_000)).max(100).nullish().catch(undefined),
  support_url: optionalText,
  privacy_policy: optionalText,
  community_contribution: z.boolean(),
  details: galleryDetailsSchema.nullish().catch(undefined),
});

/** Select one supported locale before stripping every noncanonical detail field. */
export function localizedGalleryProductSchema(
  locale: string,
): z.ZodType<GalleryProduct, z.ZodTypeDef, unknown> {
  return galleryProductSchema.extend({
    details: z.preprocess((value) => {
      if (locale === 'en_us' || !value || typeof value !== 'object' || Array.isArray(value))
        return value;
      const field = `installation_instructions_${locale}`;
      if (!Object.hasOwn(value, field)) return value;
      const localized = optionalText.parse(Reflect.get(value, field));
      return localized?.trim() ? { ...value, installation_instructions: localized } : value;
    }, galleryDetailsSchema.nullish().catch(undefined)),
  });
}

export const galleryListProductsSchema = z.object({
  items: z.array(galleryProductSchema).max(1_000),
  page: z.number().int().positive(),
  per_page: z.number().int().min(2).max(1_000),
  total: z.number().int().nonnegative().nullable().optional(),
  next: z.unknown().optional(),
});

export const galleryListTagsSchema = z.object({ tags: z.array(galleryTagSchema).max(10_000) });

export type GalleryProduct = z.infer<typeof galleryProductSchema>;
export type GalleryTag = z.infer<typeof galleryTagSchema>;
export interface GalleryListProducts {
  products: GalleryProduct[];
  page: number;
  per_page: number;
  total: number | null;
  next?: unknown;
}
