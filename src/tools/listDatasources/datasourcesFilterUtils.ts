import { z } from 'zod';

// === Field and Operator Definitions ===

export const FilterFieldSchema = z.enum([
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

export type FilterField = z.infer<typeof FilterFieldSchema>;

export const FilterOperatorSchema = z.enum(['eq', 'in', 'gt', 'gte', 'lt', 'lte']);

export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

export const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
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

// === Filter Expression Schema ===

export const FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

export type FilterExpression = z.infer<typeof FilterExpressionSchema>;

// === Validation Utilities ===

export function isOperatorAllowed(field: FilterField, operator: FilterOperator): boolean {
  const allowed = allowedOperatorsByField[field];
  return allowed.includes(operator);
}

function isISO8601DateTime(value: string): boolean {
  // Basic ISO 8601 regex (covers most common cases)
  // Example: 2016-05-04T21:24:49Z
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value);
}

/**
 * Parses and validates a Tableau-style filter string
 * @param filterString e.g. 'name:eq:Project Views,type:eq:Workbook'
 * @returns validated filter string
 * @throws ZodError or custom error for invalid operators
 */
export function parseAndValidateFilterString(filterString: string): string {
  const expressions = filterString.split(',').filter(Boolean);

  const parsedFilters: Record<string, FilterExpression> = {};

  for (const expr of expressions) {
    const [fieldRaw, operatorRaw, ...valueParts] = expr.split(':');
    if (!fieldRaw || !operatorRaw || valueParts.length === 0) {
      throw new Error(`Invalid filter expression format: "${expr}"`);
    }

    const value = valueParts.join(':');

    const field = FilterFieldSchema.parse(fieldRaw);
    const operator = FilterOperatorSchema.parse(operatorRaw);

    if (!isOperatorAllowed(field, operator)) {
      throw new Error(`Operator '${operator}' is not allowed for field '${field}'`);
    }

    // Validate ISO 8601 for createdAt and updatedAt
    if ((field === 'createdAt' || field === 'updatedAt') && !isISO8601DateTime(value)) {
      throw new Error(
        `Value for field '${field}' must be a valid ISO 8601 date-time string (e.g., 2016-05-04T21:24:49Z)`,
      );
    }

    parsedFilters[field] = { field, operator, value };
  }

  // Reconstruct the filter string from validated and decoded filters
  return Object.values(parsedFilters)
    .map((f) => `${f.field}:${f.operator}:${f.value}`)
    .join(',');
}
