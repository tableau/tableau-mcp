import { DatasourceQuery } from '../queryDatasourceValidator.js';

export function validateFilters(filters: DatasourceQuery['filters']): void {
  if (!filters) {
    return;
  }

  {
    // You can't have multiple filters for a single field.
    const fieldCounts = filters.reduce<Record<string, number>>((acc, filter) => {
      if (!('fieldCaption' in filter.field)) {
        return acc;
      }

      if (!acc[filter.field.fieldCaption]) {
        acc[filter.field.fieldCaption] = 0;
      }

      acc[filter.field.fieldCaption]++;
      return acc;
    }, {});

    const fieldsWithMultipleFilters = Object.entries(fieldCounts).filter(([_, count]) => count > 1);

    if (fieldsWithMultipleFilters.length > 0) {
      throw new Error(
        `The query must not include multiple filters for the following fields: ${fieldsWithMultipleFilters.map(([field]) => field).join(', ')}.`,
      );
    }
  }
}
