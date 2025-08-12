import { z } from 'zod';

import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../utils/parseAndValidateFilterString.js';

const FilterFieldSchema = z.enum([
  'createdAt',
  'contentUrl',
  'displayTabs',
  'favoritesTotal',
  'hasAlerts',
  'hasExtracts',
  'name',
  'ownerDomain',
  'ownerEmail',
  'ownerName',
  'projectName',
  'sheetCount',
  'size',
  'subscriptionTotal',
  'tags',
  'updatedAt',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  createdAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  contentUrl: ['eq', 'in'],
  displayTabs: ['eq'],
  favoritesTotal: ['eq', 'gt', 'gte', 'lt', 'lte'],
  hasAlerts: ['eq'],
  hasExtracts: ['eq'],
  name: ['eq', 'in'],
  ownerDomain: ['eq', 'in'],
  ownerEmail: ['eq', 'in'],
  ownerName: ['eq', 'in'],
  projectName: ['eq', 'in'],
  sheetCount: ['eq', 'gt', 'gte', 'lt', 'lte'],
  size: ['eq', 'gt', 'gte', 'lt', 'lte'],
  subscriptionTotal: ['eq', 'gt', 'gte', 'lt', 'lte'],
  tags: ['eq', 'in'],
  updatedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
};

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export function parseAndValidateWorkbooksFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

export const exportedForTesting = {
  FilterFieldSchema,
};
