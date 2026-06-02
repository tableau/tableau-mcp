import { z } from 'zod';

import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../../../utils/parseAndValidateFilterString.js';

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
 * Extract the value of an `ownerName:eq:<value>` clause from an already-validated
 * filter string. Returns `undefined` if the filter is missing or has no such clause.
 *
 * The Tableau Flows API matches `ownerName` against the user's `fullName` (display
 * name) only — not their login (`user.name`, often an email) or user id. We surface
 * a recovery hint when an `ownerName:eq:<v>` filter returned 0 results AND `<v>`
 * looks like a login/email/id (see {@link looksLikeLoginNotFullName}). This helper
 * isolates the parsing so the detection logic stays simple.
 */
export function extractOwnerNameEqValue(filter: string | undefined): string | undefined {
  if (!filter) {
    return undefined;
  }
  for (const expr of filter.split(',')) {
    const [field, operator, ...rest] = expr.trim().split(':');
    if (field === 'ownerName' && operator === 'eq' && rest.length > 0) {
      return rest.join(':');
    }
  }
  return undefined;
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
 */
export function looksLikeLoginNotFullName(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') {
    return false;
  }
  if (trimmed.includes('@')) {
    return true;
  }
  if (UUID_REGEX.test(trimmed)) {
    return true;
  }
  if (!/\s/.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Extract the value of a `projectId:eq:<value>` clause from an already-validated
 * filter string. Mirror of {@link extractOwnerNameEqValue} for project-id
 * recovery hints.
 */
export function extractProjectIdEqValue(filter: string | undefined): string | undefined {
  if (!filter) {
    return undefined;
  }
  for (const expr of filter.split(',')) {
    const [field, operator, ...rest] = expr.trim().split(':');
    if (field === 'projectId' && operator === 'eq' && rest.length > 0) {
      return rest.join(':');
    }
  }
  return undefined;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Does the supplied value match the canonical 8-4-4-4-12 hex UUID shape?
 * Used by the `projectId:eq:<v>` empty-result recovery hint to detect when an
 * LLM has likely passed a project name (or other non-UUID identifier) into a
 * field that requires a UUID. The Tableau Flows API silently returns 0 results
 * for any value that doesn't match a real project id, so without this hint a
 * malformed value is indistinguishable from "no flows in this project".
 */
export function looksLikeUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

export const exportedForTesting = {
  FilterFieldSchema,
};
