import { z } from 'zod';

export const collectionFilterFields = [
  'ownerLuid',
  'visibility',
  'createdTime',
  'updatedTime',
  'luid',
  'siteId',
  'favorite',
] as const;
export const collectionItemFilterFields = [
  'ownerLuid',
  'title',
  'createdTime',
  'modifiedTime',
  'luid',
  'type',
  'favorite',
] as const;
const collectionSortFields = [
  'visibility',
  'createdTime',
  'updatedTime',
  'ownerName',
  'name',
  'modifiedTime',
] as const;
const collectionItemSortFields = [
  'position',
  'createdTime',
  'modifiedTime',
  'ownerName',
  'title',
  'type',
] as const;

/** Collections has no documented operator-by-field matrix; expose only local eq filtering. */
function filterSchema(fields: readonly string[]): z.ZodEffects<z.ZodString> {
  return z.string().superRefine((value, context) => {
    const seen = new Set<string>();
    for (const expression of value.split(',')) {
      const [field, operator, ...parts] = expression.split(':');
      const filterValue = parts.join(':');
      if (
        !fields.includes(field) ||
        operator !== 'eq' ||
        !filterValue ||
        /[&,]/.test(filterValue) ||
        seen.has(field)
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Use distinct documented fields with field:eq:value; values cannot contain & or comma. Only eq is exposed by this candidate.',
        });
        continue;
      }
      seen.add(field);
      if (field === 'favorite' && !['true', 'false'].includes(filterValue)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'favorite must be true or false.',
        });
      }
      if (field === 'visibility' && !['public', 'private'].includes(filterValue)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'visibility must be public or private.',
        });
      }
      if (
        ['createdTime', 'updatedTime', 'modifiedTime'].includes(field) &&
        (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          filterValue,
        ) ||
          !Number.isFinite(Date.parse(filterValue)))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Timestamp filters must be ISO 8601 date-times with a timezone.',
        });
      }
    }
  });
}

function sortSchema(fields: readonly string[]): z.ZodEffects<z.ZodString> {
  return z.string().refine((value) => {
    const [field, direction, ...rest] = value.split(':');
    return fields.includes(field) && ['asc', 'desc'].includes(direction) && rest.length === 0;
  }, 'Use one documented field with field:asc or field:desc.');
}

export const collectionsFilterSchema = filterSchema(collectionFilterFields);
export const collectionItemsFilterSchema = filterSchema(collectionItemFilterFields);
export const collectionsSortSchema = sortSchema(collectionSortFields);
export const collectionItemsSortSchema = sortSchema(collectionItemSortFields);
