import { Err, Ok, Result } from 'ts-results-es';

import { FilterField, Query } from '../queryDatasourceValidator.js';
import { hasFieldCaptionAndCalculation, hasFunctionAndCalculation } from './validateFields.js';

export function validateFilters(filters: Query['filters']): void {
  if (!filters) {
    return;
  }

  if (filters.some((filter) => !('field' in filter))) {
    throw new Error(
      `The query must not include filters with invalid fields. The following field errors occurred: The filter must include a field property.`,
    );
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

  {
    // Fields must be valid.
    const filtersWithInvalidFields = filters.reduce<Array<string>>((acc, filter) => {
      if (!('field' in filter)) {
        return acc;
      }

      const result = validateFilterField(filter.field);
      if (result.isErr()) {
        acc.push(result.error);
      }

      return acc;
    }, []);

    if (filtersWithInvalidFields.length > 0) {
      throw new Error(
        `The query must not include filters with invalid fields. The following field errors occurred: ${filtersWithInvalidFields.join(', ')}.`,
      );
    }
  }

  {
    // Set, Match, and Relative Date filters can't have functions or calculations.
    const setFiltersWithFunctionsOrCalculations = filters.filter((filter) => {
      return (
        ['SET', 'MATCH', 'DATE'].includes(filter.filterType) &&
        (('function' in filter.field && filter.field.function) ||
          ('calculation' in filter.field && filter.field.calculation))
      );
    });

    if (setFiltersWithFunctionsOrCalculations.length > 0) {
      throw new Error(
        `The query must not include Set Filters, Match Filters, or Relative Date Filters with functions or calculations.`,
      );
    }
  }

  {
    // Set filters
    {
      // Values array can't be empty.
      const setFiltersWithEmptyValues = filters.filter((filter) => {
        return filter.filterType === 'SET' && filter.values.length === 0;
      });

      if (setFiltersWithEmptyValues.length > 0) {
        throw new Error(`The query must not include Set Filters with an empty values array.`);
      }
    }
  }

  {
    // Quantitative filters
    {
      // Dates must be valid RFC 3339.
      const quantitativeDateFiltersWithInvalidDates = filters.filter((filter) => {
        if (filter.filterType !== 'QUANTITATIVE_DATE') {
          return false;
        }

        switch (filter.quantitativeFilterType) {
          case 'RANGE':
            return isNaN(Date.parse(filter.minDate)) || isNaN(Date.parse(filter.maxDate));
          case 'MIN':
            return isNaN(Date.parse(filter.minDate));
          case 'MAX':
            return isNaN(Date.parse(filter.maxDate));
        }
      });

      if (quantitativeDateFiltersWithInvalidDates.length > 0) {
        throw new Error(
          `The query must not include Quantitative Date Filters with invalid dates. Dates must use the RFC 3339 standard. Example: 2025-03-14`,
        );
      }
    }
  }

  {
    // Relative Date Filters
    {
      // Dates must be valid RFC 3339.
      const relativeDateFiltersWithInvalidDates = filters.filter((filter) => {
        return (
          filter.filterType === 'DATE' && filter.anchorDate && isNaN(Date.parse(filter.anchorDate))
        );
      });

      if (relativeDateFiltersWithInvalidDates.length > 0) {
        throw new Error(
          `The query must not include Relative Date Filters with invalid anchor dates. Anchor dates must use the RFC 3339 standard. Example: 2025-03-14`,
        );
      }
    }
  }

  {
    // Top N Filters
    {
      // Field to measure must be valid.
      const topNFiltersWithInvalidFields = filters.reduce<Array<string>>((acc, filter) => {
        if (filter.filterType !== 'TOP') {
          return acc;
        }

        const result = validateFilterField(filter.fieldToMeasure);
        if (result.isErr()) {
          acc.push(result.error);
        }

        return acc;
      }, []);

      if (topNFiltersWithInvalidFields.length > 0) {
        throw new Error(
          `The query must not include Top N filters with invalid fields. The following field errors occurred: ${topNFiltersWithInvalidFields.join(', ')}`,
        );
      }
    }
  }

  {
    // Match Filters
    {
      // You must have at least one of startsWith, endsWith, or contains.
      const matchFiltersWithInvalidFields = filters.reduce<Array<string>>((acc, filter) => {
        if (filter.filterType !== 'MATCH') {
          return acc;
        }

        if (!filter.startsWith && !filter.endsWith && !filter.contains) {
          acc.push(
            `The match filter for field "${filter.field.fieldCaption}" must include at least one of the following properties: startsWith, endsWith, or contains`,
          );
        }

        return acc;
      }, []);

      if (matchFiltersWithInvalidFields.length > 0) {
        throw new Error(
          `The query must not include Match Filters with invalid fields. The following field errors occurred: ${matchFiltersWithInvalidFields.join(', ')}.`,
        );
      }
    }
  }
}

function validateFilterField(field: FilterField): Result<void, string> {
  {
    // Field caption must be a non-empty string.
    if (hasEmptyFieldCaption(field)) {
      return new Err(`The fieldCaption property must be a non-empty string.`);
    }
  }

  {
    // Field cannot have a fieldCaption and a Calculation.
    if (hasFieldCaptionAndCalculation(field)) {
      const fieldCaption = 'fieldCaption' in field ? `"${field.fieldCaption}" ` : '';
      return new Err(
        `The field ${fieldCaption} must not contain both a fieldCaption and a calculation.`.replace(
          '  ',
          ' ',
        ),
      );
    }
  }

  {
    // A Field cannot contain both a Function and a Calculation.
    if (hasFunctionAndCalculation(field)) {
      const fieldCaption = 'fieldCaption' in field ? `"${field.fieldCaption}" ` : '';
      return new Err(
        `The field ${fieldCaption} must not contain both a function and a calculation.`.replace(
          '  ',
          ' ',
        ),
      );
    }
  }

  return Ok.EMPTY;
}

function hasEmptyFieldCaption(field: FilterField): boolean {
  return 'fieldCaption' in field && !field.fieldCaption;
}
