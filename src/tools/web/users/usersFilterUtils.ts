import { z } from 'zod';

import { User } from '../../../sdks/tableau/types/user.js';
import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
} from '../../../utils/parseAndValidateFilterString.js';

// === Field and Operator Definitions ===
// Client-side filtering for users (API doesn't support server-side filtering)

// Only fields we actually request from Tableau (see listUsers.ts `fields`) are
// filterable. Filtering on an un-fetched field would silently match nothing —
// the same class of bug as the original lastLogin defect — so unsupported
// fields are rejected at parse time with a clear validation error instead.
const FilterFieldSchema = z.enum(['id', 'name', 'siteRole', 'email', 'fullName', 'lastLogin']);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  id: ['eq', 'in'],
  name: ['eq', 'in'],
  siteRole: ['eq', 'in'],
  email: ['eq', 'in'],
  fullName: ['eq', 'in'],
  lastLogin: ['eq', 'gt', 'gte', 'lt', 'lte'],
};

const dateFields: Set<FilterField> = new Set(['lastLogin']);

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export function parseAndValidateUsersFilterString(filterString: string): string {
  return parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });
}

/**
 * Build a reusable per-user predicate from a filter string. This is the single
 * source of truth for the client-side filter logic: both {@link applyUserFilters}
 * (used to filter an already-fetched array) and the pagination-loop `filterFn`
 * in listUsers.ts build on it, so `limit` can bound POST-filter matches without
 * duplicating the parse/match logic.
 *
 * Parses/validates the filter string ONCE (throwing on invalid field/operator),
 * then returns a predicate that evaluates every parsed expression against a
 * single user with AND logic. When `filterString` is falsy the predicate accepts
 * every user (matching the "no filter → all users" behavior).
 *
 * Supports field:operator:value syntax (e.g., "siteRole:eq:Creator") and
 * multiple conditions on the same field (e.g., "lastLogin:gt:X,lastLogin:lt:Y"
 * for date ranges).
 */
export function buildUserFilterPredicate(
  filterString: string | undefined,
): (user: User) => boolean {
  if (!filterString) {
    return () => true;
  }

  // Parse filter expressions directly to preserve duplicate fields (e.g., date ranges)
  const expressions = filterString
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean);

  const filters = expressions.map((expr) => {
    const [fieldRaw, operatorRaw, ...valueParts] = expr.split(':');
    const field = FilterFieldSchema.parse(fieldRaw);
    const operator = FilterOperatorSchema.parse(operatorRaw);

    if (!allowedOperatorsByField[field].includes(operator)) {
      throw new Error(
        `Operator '${operator}' is not allowed for field '${field}'. Allowed operators: ${allowedOperatorsByField[field].join(', ')}`,
      );
    }

    return {
      field,
      operator,
      value: valueParts.join(':'),
    };
  });

  return (user: User): boolean =>
    filters.every(({ field, operator, value }) => {
      const fieldValue = getFieldValue(user, field);
      return matchesFilter(fieldValue, operator, value, field);
    });
}

/**
 * Apply client-side filtering to users based on filter expressions. Thin wrapper
 * over {@link buildUserFilterPredicate} kept for callers that filter an
 * already-materialized array.
 */
export function applyUserFilters(users: User[], filterString: string | undefined): User[] {
  const predicate = buildUserFilterPredicate(filterString);
  return users.filter(predicate);
}

function getFieldValue(user: User, field: FilterField): string | number | undefined {
  switch (field) {
    case 'id':
      return user.id;
    case 'name':
      return user.name;
    case 'siteRole':
      return user.siteRole;
    case 'email':
      return user.email;
    case 'fullName':
      return user.fullName;
    case 'lastLogin':
      return user.lastLogin;
    default:
      return undefined;
  }
}

function matchesFilter(
  fieldValue: string | number | undefined,
  operator: FilterOperator,
  filterValue: string,
  field: FilterField,
): boolean {
  if (fieldValue === undefined || fieldValue === null) {
    // A missing date field means the event never happened. For `lastLogin`,
    // Tableau emits no value for users who have never signed in. Such users are
    // the *most* inactive, and the user-license-reclamation prompt explicitly
    // treats them as reclamation candidates, so an "older than X" filter must
    // include them:
    //   - lt / lte (older than / on-or-before X)  → MATCH  (never < any date)
    //   - gt / gte (newer than / on-or-after X)    → NO MATCH (they logged in after nothing)
    //   - eq (equals a specific date)              → NO MATCH (no date to equal)
    // Non-date fields keep the original "missing → no match" behavior.
    if (dateFields.has(field)) {
      return operator === 'lt' || operator === 'lte';
    }
    return false;
  }

  const fieldStr = String(fieldValue);

  switch (operator) {
    case 'eq':
      if (dateFields.has(field)) {
        return new Date(fieldStr).getTime() === new Date(filterValue).getTime();
      }
      return fieldStr === filterValue;
    case 'in':
      return filterValue.split('|').includes(fieldStr);
    case 'gt':
      if (dateFields.has(field)) {
        return new Date(fieldStr).getTime() > new Date(filterValue).getTime();
      }
      return typeof fieldValue === 'number'
        ? fieldValue > Number(filterValue)
        : fieldStr > filterValue;
    case 'gte':
      if (dateFields.has(field)) {
        return new Date(fieldStr).getTime() >= new Date(filterValue).getTime();
      }
      return typeof fieldValue === 'number'
        ? fieldValue >= Number(filterValue)
        : fieldStr >= filterValue;
    case 'lt':
      if (dateFields.has(field)) {
        return new Date(fieldStr).getTime() < new Date(filterValue).getTime();
      }
      return typeof fieldValue === 'number'
        ? fieldValue < Number(filterValue)
        : fieldStr < filterValue;
    case 'lte':
      if (dateFields.has(field)) {
        return new Date(fieldStr).getTime() <= new Date(filterValue).getTime();
      }
      return typeof fieldValue === 'number'
        ? fieldValue <= Number(filterValue)
        : fieldStr <= filterValue;
    default:
      return false;
  }
}

export const exportedForTesting = {
  FilterFieldSchema,
  applyUserFilters,
  getFieldValue,
  matchesFilter,
};
