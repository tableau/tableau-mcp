import { z } from 'zod';

import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../utils/parseAndValidateFilterString.js';

const FilterFieldSchema = z.enum(['ownerId', 'viewId', 'workbookId']);

type FilterField = z.infer<typeof FilterFieldSchema>;

// Note that this set is based off the requirement of the List Custom Views REST API, which states:
// "The supported filters for custom views use the eq (equals) operator, with the resources: viewId, ownerId, and workbookId."
// This is a subset of the custom view filter fields listed in the table at https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#custom-views
const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  ownerId: ['eq'],
  viewId: ['eq'],
  workbookId: ['eq'],
};

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export function parseAndValidateCustomViewsFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

export const exportedForTesting = {
  FilterFieldSchema,
};
