import { Filter, Query } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';

export type ContextFilterWarning = {
  type: 'MISSING_CONTEXT_ON_DIMENSION_FILTER';
  severity: 'WARNING';
  message: string;
  affectedFilters: string[];
};

const DIMENSION_FILTER_TYPES: ReadonlySet<Filter['filterType']> = new Set([
  'SET',
  'DATE',
  'QUANTITATIVE_DATE',
  'QUANTITATIVE_NUMERICAL',
  'MATCH',
]);

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

  const affectedFilters = query.filters
    .filter((f) => DIMENSION_FILTER_TYPES.has(f.filterType) && f.context !== true)
    .map((f) =>
      'fieldCaption' in f.field
        ? f.field.fieldCaption
        : 'calculation' in f.field
          ? f.field.calculation
          : null,
    )
    .filter((name): name is string => name !== null);

  if (affectedFilters.length === 0) {
    return [];
  }

  return [
    {
      type: 'MISSING_CONTEXT_ON_DIMENSION_FILTER',
      severity: 'WARNING',
      message: `Query contains a TOP/BOTTOM filter combined with dimension filters that are missing 'context: true'. Without context, the TOP filter may operate on the full dataset instead of the filtered subset, which can produce unexpected results (e.g., null values). Add 'context: true' to these dimension filters: ${affectedFilters.join(', ')}.`,
      affectedFilters,
    },
  ];
}
