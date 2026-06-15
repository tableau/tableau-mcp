import { z } from 'zod';

import {
  FilterOperator,
  FilterOperatorSchema,
} from '../../../utils/parseAndValidateFilterString.js';

// Fields and operators the Tableau REST API documents as filterable for the Jobs
// endpoint. The 'has' (contains) operator applies to free-text fields; note that
// some fields (args, notes) only support 'has', and status only supports 'eq'.
//
// Source: https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm#jobs
const FilterFieldSchema = z.enum([
  'args',
  'completedAt',
  'createdAt',
  'jobType',
  'notes',
  'priority',
  'progress',
  'startedAt',
  'status',
  'subtitle',
  'title',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const DATE_OPERATORS: (FilterOperator | 'has')[] = ['eq', 'gt', 'gte', 'lt', 'lte'];
const NUMERIC_OPERATORS: (FilterOperator | 'has')[] = ['eq', 'gt', 'gte', 'lt', 'lte'];

const allowedOperatorsByField: Record<FilterField, (FilterOperator | 'has')[]> = {
  args: ['has'],
  completedAt: DATE_OPERATORS,
  createdAt: DATE_OPERATORS,
  jobType: ['eq', 'in'],
  notes: ['has'],
  priority: NUMERIC_OPERATORS,
  progress: NUMERIC_OPERATORS,
  startedAt: DATE_OPERATORS,
  status: ['eq'],
  subtitle: ['eq', 'has'],
  title: ['eq', 'has'],
};

/**
 * Splits a filter string into individual expressions on commas, ignoring commas
 * inside square brackets. This keeps multi-value `in` filters such as
 * `jobType:in:[refresh_extracts,run_flow]` intact instead of shredding them.
 */
function splitFilterExpressions(filterString: string): string[] {
  const expressions: string[] = [];
  let current = '';
  let bracketDepth = 0;

  for (const char of filterString) {
    if (char === '[') {
      bracketDepth++;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    }

    if (char === ',' && bracketDepth === 0) {
      expressions.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  expressions.push(current);

  return expressions;
}

/**
 * Validates a filter string for the Jobs API.
 * The Tableau REST API supports server-side filtering with operators including 'has' for text fields.
 * This validates the filter format before sending to the API.
 */
export function parseAndValidateJobsFilterString(filterString: string): string {
  const expressions = splitFilterExpressions(filterString)
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

    const allowed = allowedOperatorsByField[field];
    if (!allowed.includes(operator)) {
      throw new Error(
        `Operator '${operator}' is not allowed for field '${field}'. Allowed operators: ${allowed.join(', ')}`,
      );
    }

    // The REST API expects `in` values as a bracketed list, e.g. jobType:in:[a,b].
    if (operator === 'in' && !(value.startsWith('[') && value.endsWith(']'))) {
      throw new Error(
        `The 'in' operator for field '${field}' requires a bracketed value list, e.g. ${field}:in:[value1,value2].`,
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
