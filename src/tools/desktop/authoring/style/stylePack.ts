import { z } from 'zod';

const semanticVersionSchema = z
  .string()
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/,
    'Must be a semantic version',
  );
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'Must be a lowercase SHA-256 digest');
const nonBlankStringSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, 'Must not be blank');
const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i, 'Must be a six-digit hex color');
const tableauFontSchema = z.enum([
  'Tableau Bold',
  'Tableau Light',
  'Tableau Medium',
  'Tableau Regular',
  'Tableau Semibold',
]);

export const tableauStylePackV2Schema = z
  .object({
    schema: z.literal('tableau.style-pack/v2'),
    pack: nonBlankStringSchema,
    version: semanticVersionSchema,
    provenance: z
      .object({
        title: nonBlankStringSchema,
        sourceSha256: sha256Schema,
      })
      .strict(),
    typography: z
      .object({
        titleFont: tableauFontSchema,
        bodyFont: tableauFontSchema,
      })
      .strict(),
    palette: z
      .object({
        brandPrimary: hexColorSchema,
        categorical: z.array(hexColorSchema).min(2),
        sequential: z.array(hexColorSchema).min(2),
        diverging: z
          .object({
            negative: hexColorSchema,
            midpoint: hexColorSchema,
            positive: hexColorSchema,
          })
          .strict(),
        text: hexColorSchema,
        background: hexColorSchema,
      })
      .strict(),
    formats: z
      .object({
        currency: z.literal('USD_ABBREVIATED'),
        date: z.literal('yyyy-mm-dd'),
        time: z.literal('HH:mm UTC'),
        fiscalQuarter: z.literal('Qn'),
        fiscalYear: z.literal('FYyy'),
        fiscalYearQuarter: z.literal('FYyy-Qn'),
      })
      .strict(),
    dashboard: z
      .object({
        outerPadding: z.number().int().nonnegative(),
        innerSpacing: z.number().int().nonnegative(),
        titleAlignment: z.enum(['left', 'center', 'right']),
      })
      .strict(),
    advisoryRules: z
      .object({
        avoidPieCharts: z.boolean(),
        labelCalculatedData: z.boolean(),
      })
      .strict(),
  })
  .strict();

export type TableauStylePackV2 = z.infer<typeof tableauStylePackV2Schema>;

export function parseStylePack(input: unknown): TableauStylePackV2 {
  return tableauStylePackV2Schema.parse(input);
}
