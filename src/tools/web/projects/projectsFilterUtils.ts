import { z } from 'zod';

import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../../utils/parseAndValidateFilterString.js';

// === Field and Operator Definitions ===
// [Tableau REST API Projects filter fields](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#projects)

const FilterFieldSchema = z.enum([
  'createdAt',
  'name',
  'ownerDomain',
  'ownerEmail',
  'ownerName',
  'parentProjectId',
  'topLevelProject',
  'updatedAt',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  createdAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  name: ['eq', 'in'],
  ownerDomain: ['eq', 'in'],
  ownerEmail: ['eq', 'in'],
  ownerName: ['eq', 'in'],
  parentProjectId: ['eq', 'in'],
  topLevelProject: ['eq'],
  updatedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
};

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export function parseAndValidateProjectsFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

export const exportedForTesting = {
  FilterFieldSchema,
};
