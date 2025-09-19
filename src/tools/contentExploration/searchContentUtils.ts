import { OrderBy, SearchContentFilter } from '../../sdks/tableau/types/contentExploration.js';

// import {
//   FilterOperator,
//   FilterOperatorSchema,
//   parseAndValidateFilterString,
// } from '../../utils/parseAndValidateFilterString.js';

// const FilterFieldSchema = z.enum(['type', 'ownerId', 'modifiedTime']);

// type FilterField = z.infer<typeof FilterFieldSchema>;

// const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
//   type: ['eq', 'in'],
//   ownerId: ['eq', 'in'],
//   modifiedTime: ['eq', 'gt', 'gte', 'lt', 'lte'], // TODO: Test if 'lt' is allowed
// };

// const _FilterExpressionSchema = z.object({
//   field: FilterFieldSchema,
//   operator: FilterOperatorSchema,
//   value: z.string(),
// });

// type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

// export function parseAndValidateSearchContentFilterString(filter: string): string {
//   return parseAndValidateFilterString<FilterField, FilterExpression>({
//     filterString: filter,
//     allowedOperatorsByField,
//     filterFieldSchema: FilterFieldSchema,
//   });
// }

export function buildOrderByString(orderBy: OrderBy): string {
  const methodsUsed = new Set<string>();
  for (const ordering of orderBy) {
    if (methodsUsed.has(ordering.method)) {
      // TODO: Should we ignore duplicate ordering methods instead of throwing an error?
      throw new Error(
        `The 'orderBy' parameter can only contain one of each sorting method. The sorting method: '${ordering.method}' is used more than once in the 'orderBy' array.`,
      );
    }
    methodsUsed.add(ordering.method);
  }

  return orderBy
    .map(
      (ordering) => ordering.method + (ordering.sortDirection ? `:${ordering.sortDirection}` : ''),
    )
    .join(',');
}

export function buildFilterString(filter: SearchContentFilter): string {
  const filterExpressions = new Array<string>();
  if (filter.contentTypes) {
    if (filter.contentTypes.length === 1) {
      filterExpressions.push(`type:eq:${filter.contentTypes[0]}`);
    } else {
      const typesUsed = new Set<string>();
      for (const type of filter.contentTypes) {
        if (typesUsed.has(type)) {
          // TODO: Should we ignore duplicate types instead of throwing an error?
          throw new Error(
            `The 'contentTypes' array in the 'filter' parameter can only contain one of each content type. The content type: '${type}' is used more than once in the 'contentTypes' array.`,
          );
        }
        typesUsed.add(type);
      }
      filterExpressions.push(`type:in:[${filter.contentTypes.join(',')}]`);
    }
  }
  if (filter.ownerIds) {
    if (filter.ownerIds.length === 1) {
      filterExpressions.push(`ownerId:eq:${filter.ownerIds[0]}`);
    } else {
      const idsUsed = new Set<string>();
      for (const id of filter.ownerIds) {
        if (idsUsed.has(id)) {
          // TODO: Should we ignore duplicate ids instead of throwing an error?
          throw new Error(
            `The 'ownerIds' array in the 'filter' parameter can only contain one of each owner id. The owner id: '${id}' is used more than once in the 'ownerIds' array.`,
          );
        }
        idsUsed.add(id);
      }
      filterExpressions.push(`ownerId:in:[${filter.ownerIds.join(',')}]`);
    }
  }
  if (filter.modifiedTime) {
    // TODO: Refine logic for this
    for (const modifiedTime of filter.modifiedTime) {
      filterExpressions.push(`modifiedTime:${modifiedTime.operator}:${modifiedTime.value}`);
    }
  }

  return filterExpressions.join('&');
}
