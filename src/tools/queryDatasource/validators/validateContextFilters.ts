import { Filter, Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';

type ContextFilterWarning = {
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
      message: `Query contains a TOP/BOTTOM filter combined with dimension filters that are missing 'context: true'. Without context, the TOP filter may operate on the full dataset instead of the filtered subset, which can produce unexpected results (e.g., null values). Add 'context: true' to these dimension filters: ${affectedFilters.join(', ')}.`,
      affectedFilters,
    },
  ];
}
