import { z } from 'zod';

import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../../utils/parseAndValidateFilterString.js';

const HasOperatorSchema = z.enum(['eq', 'in', 'gt', 'gte', 'lt', 'lte', 'has']);
type HasOperator = z.infer<typeof HasOperatorSchema>;

const FilterFieldSchema = z.enum([
  'jobType',
  'status',
  'progress',
  'createdAt',
  'startedAt',
  'endedAt',
  'title',
  'notes',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  jobType: ['eq', 'in'],
  status: ['eq', 'in'],
  progress: ['eq', 'gt', 'gte', 'lt', 'lte'],
  createdAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  startedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  endedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  title: ['eq', 'in'],
  notes: ['eq', 'in'],
};

// Extended operators that include 'has' for string fields (server-side)
const allowedOperatorsWithHas: Record<FilterField, (FilterOperator | 'has')[]> = {
  ...allowedOperatorsByField,
  title: ['eq', 'in', 'has' as FilterOperator],
  notes: ['eq', 'in', 'has' as FilterOperator],
};

/**
 * Validates a filter string for the Jobs API.
 * The Tableau REST API supports server-side filtering with operators including 'has' for text fields.
 * This validates the filter format before sending to the API.
 */
export function parseAndValidateJobsFilterString(filterString: string): string {
  const expressions = filterString
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  const validated: string[] = [];

  for (const expr of expressions) {
    const [fieldRaw, operatorRaw, ...valueParts] = expr.split(':');
    if (!fieldRaw || !operatorRaw || valueParts.length === 0) {
      throw new Error(`Invalid filter expression format: "${expr}"`);
    }

    const value = valueParts.join(':');
    const field = FilterFieldSchema.parse(fieldRaw);
    const operator = operatorRaw as FilterOperator | 'has';

    // Validate the operator
    if (operator !== 'has') {
      FilterOperatorSchema.parse(operator);
    }

    const allowed = allowedOperatorsWithHas[field];
    if (!allowed.includes(operator)) {
      throw new Error(
        `Operator '${operator}' is not allowed for field '${field}'. Allowed operators: ${allowed.join(', ')}`,
      );
    }

    validated.push(`${field}:${operator}:${value}`);
  }

  return validated.join(',');
}

export const exportedForTesting = {
  FilterFieldSchema,
  parseAndValidateJobsFilterString,
};
