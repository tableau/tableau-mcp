import { z } from 'zod';

import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../../../utils/parseAndValidateFilterString.js';
import { looksLikeUuid } from '../flowFilterUtils.js';

// Tableau's Flows endpoint supports a narrower filter-field set than e.g. Workbooks.
// The fields and per-field operator allow-lists below mirror the official spec at
// https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm
// (the "Flows" table). They were also live-verified against REST 3.30: any
// other field, or any operator outside the allow-list (e.g. `ownerName:in:`,
// `projectId:in:`), is rejected by the server with HTTP 400. Keep this in sync
// with the spec.
const FilterFieldSchema = z.enum([
  'createdAt',
  'name',
  'ownerName',
  'projectId',
  'projectName',
  'updatedAt',
]);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  createdAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  name: ['eq', 'in'],
  ownerName: ['eq'],
  projectId: ['eq'],
  projectName: ['eq', 'in'],
  updatedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
};

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export function parseAndValidateFlowsFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

/**
 * Heuristic: does the supplied value look like a login / email / user id, rather
 * than a human display name?
 *
 * - Contains `@` → email (e.g. `jane.doe@example.com`)
 * - Matches the canonical UUID shape → user id
 * - Has no whitespace → likely a login token, not a multi-word display name
 *
 * False positives are limited to one-word display names (e.g. `Cher`, `Admin`).
 * The only consequence of a false positive is a slightly more verbose empty-result
 * message, so we keep the heuristic simple and conservative.
 *
 * Used by the `ownerName:eq:<v>` empty-result recovery hint: the Tableau Flows
 * API matches `ownerName` against the user's `fullName` (display name) only —
 * not their login (`user.name`, often an email) or user id — so a login-shaped
 * value silently returns 0 results.
 */
export function looksLikeLoginNotFullName(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') {
    return false;
  }
  if (trimmed.includes('@')) {
    return true;
  }
  if (looksLikeUuid(trimmed)) {
    return true;
  }
  if (!/\s/.test(trimmed)) {
    return true;
  }
  return false;
}

export const exportedForTesting = {
  FilterFieldSchema,
};
