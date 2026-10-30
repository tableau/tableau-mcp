import { z } from 'zod';

import { luidSchema } from '../../routeSafety/ids.js';

export const favoriteResourceTypes = ['workbook', 'view', 'datasource', 'project', 'flow'] as const;
export const favoriteResourceTypeSchema = z.enum(favoriteResourceTypes);
export type FavoriteResourceType = z.infer<typeof favoriteResourceTypeSchema>;

export const favoriteLabelSchema = z
  .string()
  .refine((label) => label.trim().length > 0, 'Favorite label must not be blank');

export type Favorite = {
  resourceType: FavoriteResourceType;
  resourceId: string;
  label?: string;
};

// The REST XSD also permits collection/legacy metric and label-only deleted favorites.
// Keep these envelopes opaque inside the SDK, then omit unsupported or ambiguous entries.
export const rawFavoriteSchema = z.record(z.unknown());

// These are metadata fields, not resource alternatives. Never return their values.
// https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_fields.htm
// https://help.tableau.com/samples/en-us/rest_api/ts-api_3_29.xsd (favoriteType)
const favoriteMetadataFields = new Set([
  'label',
  'parentProjectName',
  'targetOwnerName',
  'position',
  'addedAt',
]);

export function normalizeFavorite(raw: z.infer<typeof rawFavoriteSchema>): Favorite | undefined {
  // The public XSD declares addedAt as dateTime; Cloud JSON represents it as a string.
  // Its value is presentation metadata and must not escape into the returned shortlist.
  if ('addedAt' in raw && typeof raw.addedAt !== 'string') return undefined;
  // Cloud 3.30 includes position in its default response. It is opaque display metadata.
  if (
    'position' in raw &&
    typeof raw.position !== 'string' &&
    !(typeof raw.position === 'number' && Number.isFinite(raw.position))
  ) {
    return undefined;
  }
  const contentKeys = Object.keys(raw).filter((key) => !favoriteMetadataFields.has(key));
  if (contentKeys.length !== 1) return undefined;
  const resourceType = favoriteResourceTypeSchema.safeParse(contentKeys[0]);
  if (!resourceType.success) return undefined;
  const resource = z.object({ id: luidSchema }).safeParse(raw[resourceType.data]);
  if (!resource.success) return undefined;
  return {
    resourceType: resourceType.data,
    resourceId: resource.data.id,
    ...(typeof raw.label === 'string' && { label: raw.label }),
  };
}
