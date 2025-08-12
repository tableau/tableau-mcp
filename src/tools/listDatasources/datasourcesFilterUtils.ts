import { z } from 'zod';

import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../utils/parseAndValidateFilterString.js';

// === Field and Operator Definitions ===
// [Tableau REST API Data Sources filter fields](https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#datasources)

const FilterFieldSchema = z.enum([
  'authenticationType',
  'connectedWorkbookType',
  'connectionTo',
  'connectionType',
  'contentUrl',
  'createdAt',
  'databaseName',
  'databaseUserName',
  'description',
  'favoritesTotal',
  'hasAlert',
  'hasEmbeddedPassword',
  'hasExtracts',
  'isCertified',
  'isConnectable',
  'isDefaultPort',
  'isHierarchical',
  'isPublished',
  'name',
  'ownerDomain',
  'ownerEmail',
  'ownerName',
  'projectName',
  'serverName',
  'serverPort',
  'size',
  'tableName',
  'tags',
  'type',
  'updatedAt',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  authenticationType: ['eq', 'in'],
  connectedWorkbookType: ['eq', 'gt', 'gte', 'lt', 'lte'],
  connectionTo: ['eq', 'in'],
  connectionType: ['eq', 'in'],
  contentUrl: ['eq', 'in'],
  createdAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  databaseName: ['eq', 'in'],
  databaseUserName: ['eq', 'in'],
  description: ['eq', 'in'],
  favoritesTotal: ['eq', 'gt', 'gte', 'lt', 'lte'],
  hasAlert: ['eq'],
  hasEmbeddedPassword: ['eq'],
  hasExtracts: ['eq'],
  isCertified: ['eq'],
  isConnectable: ['eq'],
  isDefaultPort: ['eq'],
  isHierarchical: ['eq'],
  isPublished: ['eq'],
  name: ['eq', 'in'],
  ownerDomain: ['eq', 'in'],
  ownerEmail: ['eq'],
  ownerName: ['eq', 'in'],
  projectName: ['eq', 'in'],
  serverName: ['eq', 'in'],
  serverPort: ['eq'],
  size: ['eq', 'gt', 'gte', 'lt', 'lte'],
  tableName: ['eq', 'in'],
  tags: ['eq', 'in'],
  type: ['eq'],
  updatedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
};

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export function parseAndValidateDatasourcesFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

export const exportedForTesting = {
  FilterFieldSchema,
};
