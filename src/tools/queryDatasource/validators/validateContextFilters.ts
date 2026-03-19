import { Filter, Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';

export type ContextFilterWarning = {
  type: 'MISSING_CONTEXT_ON_DIMENSION_FILTER';
  severity: 'WARNING';
  message: string;
  affectedFilters: string[];
};

const DIMENSION_ONLY_FILTER_TYPES: ReadonlySet<Filter['filterType']> = new Set([
  'SET',
  'DATE',
  'MATCH',
]);

const QUANTITATIVE_FILTER_TYPES: ReadonlySet<Filter['filterType']> = new Set([
  'QUANTITATIVE_NUMERICAL',
  'QUANTITATIVE_DATE',
]);

/**
 * Returns true if the filter is a dimension filter missing `context: true`.
 *
 * In Tableau's Order of Operations, dimension filters execute before TOP/BOTTOM,
 * so they need `context: true` to establish the correct subset. Aggregated measure
 * filters (QUANTITATIVE with a `function` on the field) execute after TOP, so
 * context doesn't apply to them.
 */
function isDimensionFilterMissingContext(f: Filter): boolean {
  if (f.context === true || f.filterType === 'TOP') {
    return false;
  }

  if (QUANTITATIVE_FILTER_TYPES.has(f.filterType)) {
    return !('function' in f.field);
  }

  return DIMENSION_ONLY_FILTER_TYPES.has(f.filterType);
}

function getFilterName(f: Filter): string {
  if ('fieldCaption' in f.field) return f.field.fieldCaption;
  if ('calculation' in f.field) return f.field.calculation;
  return 'unknown';
}

/**
 * Detects when a query has TOP/BOTTOM filters combined with dimension filters
 * that are missing `context: true`. Without context, the TOP filter may operate
 * on the full dataset rather than the filtered subset, producing unexpected results.
 *
 * This is a non-blocking validator — it returns warnings rather than errors,
 * because missing context is a subjective issue (the query still executes).
 */
export function validateContextFilters(query: Query): ContextFilterWarning[] {
  if (!query.filters || query.filters.length < 2) {
    return [];
  }

  const hasTopFilter = query.filters.some((f) => f.filterType === 'TOP');
  if (!hasTopFilter) {
    return [];
  }

  const filtersNeedingContext = query.filters.filter(isDimensionFilterMissingContext);
  if (filtersNeedingContext.length === 0) {
    return [];
  }

  const affectedFilters = filtersNeedingContext.map(getFilterName);

  return [
    {
      type: 'MISSING_CONTEXT_ON_DIMENSION_FILTER',
      severity: 'WARNING',
      message: `This query combines a TOP/BOTTOM filter with dimension filters that are not set as context filters. In Tableau’s query order, TOP filters are evaluated before regular dimension filters. This means the TOP filter selects values from the full dataset first, and the dimension filters are applied afterward. This can produce fewer results than expected (for example, showing only 8 rows when requesting Top 10), because some of the top-ranked values may not exist in the filtered subset. If your intent is to find the Top values *within* the filtered subset, add 'context: true' to one or more of these dimension filters: ${affectedFilters.join(', ')}. If your intent is to find the Top values globally and then filter them, your current query is correct.`,
      affectedFilters,
    },
  ];
}
