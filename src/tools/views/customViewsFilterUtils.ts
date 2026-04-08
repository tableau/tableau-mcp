import { z } from 'zod';

import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../utils/parseAndValidateFilterString.js';

const FilterFieldSchema = z.enum([
  'createdAt',
  'id',
  'name',
  'ownerId',
  'shared',
  'updatedAt',
  'viewId',
  'workbookId',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  createdAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  id: ['eq', 'in'],
  name: ['eq', 'in'],
  ownerId: ['eq'],
  shared: ['eq'],
  updatedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
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
