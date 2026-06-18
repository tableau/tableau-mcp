import { z } from 'zod';

import { FlowRun, flowRunStatusSchema } from '../../../../sdks/tableau/types/flow.js';
import {
  FilterOperator,
  FilterOperatorSchema,
  parseAndValidateFilterString,
  splitTopLevel,
} from '../../../../utils/parseAndValidateFilterString.js';

// The Tableau "Get Flow Runs" endpoint (GET /sites/:siteId/flows/runs) supports
// server-side filtering on the fields below. `status` is the ONE exception: it
// is NOT a server-side filter field (live-verified against REST 3.30 — passing
// `status:eq:Failed` is ignored by the server), so this tool fetches runs with
// the server-side fields applied and filters `status` client-side. We still
// validate `status` here (fields + values) so a typo surfaces as a clear error
// rather than a silent no-op.
//
// Field/operator allow-lists mirror the official spec at
// https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_concepts_filtering_and_sorting.htm
const SERVER_FILTER_FIELDS = ['flowId', 'userId', 'progress', 'startedAt', 'completedAt'] as const;

const FilterFieldSchema = z.enum([...SERVER_FILTER_FIELDS, 'status']);

type FilterField = z.infer<typeof FilterFieldSchema>;

const allowedOperatorsByField: Record<FilterField, FilterOperator[]> = {
  flowId: ['eq', 'in'],
  userId: ['eq', 'in'],
  progress: ['eq', 'gt', 'gte', 'lt', 'lte'],
  startedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  completedAt: ['eq', 'gt', 'gte', 'lt', 'lte'],
  status: ['eq', 'in'],
};

const _FilterExpressionSchema = z.object({
  field: FilterFieldSchema,
  operator: FilterOperatorSchema,
  value: z.string(),
});

type FilterExpression = z.infer<typeof _FilterExpressionSchema>;

export type ValidatedFlowRunsFilter = {
  /**
   * The portion of the filter that the Tableau API can apply server-side (the
   * `status` clause, if any, has been removed). May be an empty string.
   */
  serverFilter: string;
  /**
   * Predicate that enforces the client-side `status` clause. When the caller
   * supplied no `status` filter this is the identity predicate (always `true`).
   */
  matchesStatus: (run: FlowRun) => boolean;
  /** The full normalized filter (server + status) — used for empty-result hints. */
  normalizedFilter: string;
};

/**
 * Validate a flow-runs filter string and split it into the server-side portion
 * (passed to the REST API) and a client-side `status` predicate.
 *
 * @throws on unknown fields, disallowed operators, malformed brackets, bad
 *   date-times (startedAt/completedAt), or an unrecognized `status` value.
 */
export function parseAndValidateFlowRunsFilterString(
  filterString: string,
): ValidatedFlowRunsFilter {
  // Validates fields/operators, normalizes date-only values for
  // startedAt/completedAt, and dedupes repeated fields (last one wins).
  const normalizedFilter = parseAndValidateFilterString<FilterField, FilterExpression>({
    filterString,
    allowedOperatorsByField,
    filterFieldSchema: FilterFieldSchema,
  });

  const serverClauses: string[] = [];
  let statusClause: { operator: FilterOperator; values: string[] } | undefined;

  for (const clause of splitTopLevel(normalizedFilter, ',')
    .map((c) => c.trim())
    .filter(Boolean)) {
    const [field, operator, ...valueParts] = clause.split(':');
    const value = valueParts.join(':');
    if (field === 'status') {
      const values = parseListOrSingle(operator as FilterOperator, value);
      assertValidStatusValues(values);
      statusClause = { operator: operator as FilterOperator, values };
    } else {
      serverClauses.push(clause);
    }
  }

  return {
    serverFilter: serverClauses.join(','),
    matchesStatus: buildStatusMatcher(statusClause),
    normalizedFilter,
  };
}

/**
 * Expand an operator value into the list of values to match against. For `in`
 * the Tableau-style bracket/comma form `[A,B,C]` is unwrapped; for `eq` the
 * single value is returned as-is.
 */
function parseListOrSingle(operator: FilterOperator, value: string): string[] {
  if (operator !== 'in') {
    return [value];
  }
  const inner = value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
  return inner
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function assertValidStatusValues(values: string[]): void {
  const allowed = flowRunStatusSchema.options;
  for (const value of values) {
    if (!(allowed as readonly string[]).includes(value)) {
      throw new Error(
        `Invalid status value '${value}'. Allowed flow-run statuses: ${allowed.join(', ')}.`,
      );
    }
  }
}

function buildStatusMatcher(
  statusClause: { operator: FilterOperator; values: string[] } | undefined,
): (run: FlowRun) => boolean {
  if (!statusClause) {
    return () => true;
  }
  const allowed = new Set(statusClause.values);
  return (run) => run.status !== undefined && allowed.has(run.status);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Does the supplied value match the canonical 8-4-4-4-12 hex UUID shape? Used by
 * the `flowId:eq:<v>` empty-result recovery hint — the runs endpoint silently
 * returns 0 results for a flowId that isn't a real flow LUID (e.g. a flow name).
 */
export function looksLikeUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

/**
 * Extract the value of a `flowId:eq:<value>` clause from an already-validated
 * filter string. Returns `undefined` when no such clause is present.
 */
export function extractFlowIdEqValue(filter: string | undefined): string | undefined {
  if (!filter) {
    return undefined;
  }
  for (const expr of splitTopLevel(filter, ',')) {
    const [field, operator, ...rest] = expr.trim().split(':');
    if (field === 'flowId' && operator === 'eq' && rest.length > 0) {
      return rest.join(':');
    }
  }
  return undefined;
}

export const exportedForTesting = {
  FilterFieldSchema,
  parseListOrSingle,
  buildStatusMatcher,
};
