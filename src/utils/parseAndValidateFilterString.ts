import z from 'zod';

export const FilterOperatorSchema = z.enum(['eq', 'in', 'gt', 'gte', 'lt', 'lte']);
export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

export function isISO8601DateTime(value: string): boolean {
  // Basic ISO 8601 regex (covers most common cases)
  // Example: 2016-05-04T21:24:49Z
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value);
}

const dateTimeFields = ['createdAt', 'updatedAt'];

/**
 * Parses and validates a Tableau-style filter string
 * @param filterString e.g. 'name:eq:Project Views,type:eq:Workbook'
 * @param allowedOperatorsByField - A map of filter fields to allowed operators
 * @param filterFieldSchema - A schema for the filter field
 * @returns validated filter string
 * @throws ZodError or custom error for invalid operators
 */
export function parseAndValidateFilterString<
  TFilterField extends string,
  TFilterExpression extends { field: TFilterField; operator: FilterOperator; value: string } = {
    field: TFilterField;
    operator: FilterOperator;
    value: string;
  },
>({
  filterString,
  allowedOperatorsByField,
  filterFieldSchema,
}: {
  filterString: string;
  allowedOperatorsByField: Record<TFilterField, FilterOperator[]>;
  filterFieldSchema: z.ZodSchema<TFilterField>;
}): string {
  function isOperatorAllowed(field: TFilterField, operator: FilterOperator): boolean {
    const allowed = allowedOperatorsByField[field];
    return allowed.includes(operator);
  }

  const expressions = filterString
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  const parsedFilters: Record<string, TFilterExpression> = {};

  for (const expr of expressions) {
    const [fieldRaw, operatorRaw, ...valueParts] = expr.split(':');
    if (!fieldRaw || !operatorRaw || valueParts.length === 0) {
      throw new Error(`Invalid filter expression format: "${expr}"`);
    }

    const value = valueParts.join(':');

    const field = filterFieldSchema.parse(fieldRaw);
    const operator = FilterOperatorSchema.parse(operatorRaw);

    if (!isOperatorAllowed(field, operator)) {
      throw new Error(
        `Operator '${operator}' is not allowed for field '${field}'. Allowed operators: ${allowedOperatorsByField[field].join(', ')}`,
      );
    }

    // Validate ISO 8601 for date-time fields
    if (dateTimeFields.includes(field) && !isISO8601DateTime(value)) {
      throw new Error(
        `Value for field '${field}' must be a valid ISO 8601 date-time string (e.g., 2016-05-04T21:24:49Z)`,
      );
    }

    parsedFilters[field] = { field, operator, value } as TFilterExpression;
  }

  // Reconstruct the filter string from validated filters
  return Object.values(parsedFilters)
    .map((f) => `${f.field}:${f.operator}:${f.value}`)
    .join(',');
}

export const exportedForTesting = {
  FilterOperatorSchema,
};
