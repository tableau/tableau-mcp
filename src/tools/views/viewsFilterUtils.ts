import { z } from 'zod';

import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../utils/parseAndValidateFilterString.js';

const FilterFieldSchema = z.enum([
  'caption',
  'contentUrl',
  'createdAt',
  'favoritesTotal',
  'fields',
  'hitsTotal',
  'name',
  'ownerDomain',
  'ownerEmail',
  'ownerName',
  'projectName',
  'sheetNumber',
  'sheetType',
  'tags',
  'title',
  'updatedAt',
  'viewUrlname',
  'workbookDescription',
  'workbookName',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  caption: ['eq', 'in'],
  contentUrl: ['eq', 'in'],
  createdAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  favoritesTotal: ['eq', 'gt', 'gte', 'lt', 'lte'],
  fields: ['eq', 'in'],
  hitsTotal: ['eq', 'gt', 'gte', 'lt', 'lte'],
  name: ['eq', 'in'],
  ownerDomain: ['eq', 'in'],
  ownerEmail: ['eq', 'in'],
  ownerName: ['eq', 'in'],
  projectName: ['eq', 'in'],
  sheetNumber: ['eq', 'gt', 'gte', 'lt', 'lte'],
  sheetType: ['eq', 'in'],
  tags: ['eq', 'in'],
  title: ['eq', 'in'],
  updatedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  viewUrlname: ['eq', 'in'],
  workbookDescription: ['eq', 'in'],
  workbookName: ['eq', 'in'],
};

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export function parseAndValidateViewsFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

export const exportedForTesting = {
  FilterFieldSchema,
};
