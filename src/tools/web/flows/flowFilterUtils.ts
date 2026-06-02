// Shared filter-string helpers for the Tableau Prep flow tools (list-flows,
// list-flow-runs, …). These were previously copy-pasted per tool; keep them here
// so the UUID heuristic and `:eq:` extraction have a single source of truth.

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Does the supplied value match the canonical 8-4-4-4-12 hex UUID shape?
 *
 * Used by the flow tools' empty-result recovery hints to detect when an LLM has
 * likely passed a name (or other non-UUID identifier) into a field that requires
 * a UUID (e.g. `projectId:eq:` for list-flows, `flowId:eq:` for list-flow-runs).
 * The Tableau Flows APIs silently return 0 results (or 404) for a value that
 * isn't a real id, so without this hint a malformed value is indistinguishable
 * from "nothing matched".
 */
export function looksLikeUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

/**
 * Extract the value of a `<field>:eq:<value>` clause from an already-validated
 * filter string. Returns `undefined` when the filter is missing or has no such
 * clause.
 *
 * A plain comma split is sufficient: the target `<field>:eq:` clause is never
 * itself split (an `:eq:` value has no comma — multi-value filters use `:in:`),
 * and a bracketed `in` list elsewhere in the filter only yields junk fragments
 * that don't match `<field>:eq:`. The value may itself contain colons (e.g. an
 * `ownerName` display name), so everything after the `field:eq:` prefix is
 * rejoined.
 */
export function extractEqValue(filter: string | undefined, field: string): string | undefined {
  if (!filter) {
    return undefined;
  }
  for (const expr of filter.split(',')) {
    const [exprField, operator, ...rest] = expr.trim().split(':');
    if (exprField === field && operator === 'eq' && rest.length > 0) {
      return rest.join(':');
    }
  }
  return undefined;
}
