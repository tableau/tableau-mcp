import { Field, FilterField } from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';

export function validateFields(fields: Field[]): void {
  {
    // You must query at least one field.
    if (fields.length === 0) {
      throw new Error(
        'The query must include at least one field. The fields property cannot be an empty array.',
      );
    }
  }

  {
    // Field caption must be a non-empty string.
    if (fields.some(hasEmptyFieldCaption)) {
      throw new Error(`The query must not include any fields with an empty fieldCaption.`);
    }
  }

  {
    // You can't have duplicate sort priorities.
    const sortPriorities = fields.reduce<Record<number, Array<string>>>((acc, field) => {
      if (field.sortPriority === undefined) {
        return acc;
      }

      if (!acc[field.sortPriority]) {
        acc[field.sortPriority] = [];
      }

      acc[field.sortPriority].push(field.fieldCaption);
      return acc;
    }, {});

    const duplicateSortPriorities = Object.entries(sortPriorities).filter(
      ([_, fields]) => fields.length > 1,
    );

    if (duplicateSortPriorities.length > 0) {
      const duplicateSortPrioritiesArr = duplicateSortPriorities.reduce<Array<string>>(
        (acc, [priority, fields]) => {
          acc.push(
            `${fields.map((field) => `"${field}"`).join(', ')} with a sort priority of ${priority}`,
          );
          return acc;
        },
        [],
      );

      throw new Error(
        `The query must not include duplicate sort priorities. The following fields have sort priorities that are duplicated: ${duplicateSortPrioritiesArr.join('. ')}.`,
      );
    }
  }

  {
    // A Field cannot contain both a Function and a Calculation.
    const fieldsWithBothFunctionAndCalculation = fields
      .filter(hasFunctionAndCalculation)
      .map((field) => field.fieldCaption);

    if (fieldsWithBothFunctionAndCalculation.length > 0) {
      throw new Error(
        `The query must not include fields that contain both a function and a calculation. The following fields contain both a function and a calculation: ${fieldsWithBothFunctionAndCalculation.join(', ')}.`,
      );
    }
  }

  {
    // The maxDecimalPlaces value must be greater or equal to 0.
    const fieldsWithNegativeMaxDecimalPlace = fields
      .filter(hasNegativeMaxDecimalPlace)
      .map((field) => field.fieldCaption);

    if (fieldsWithNegativeMaxDecimalPlace.length > 0) {
      throw new Error(
        `The query must not include fields that have a maxDecimalPlaces value that is less than 0. The following fields have a maxDecimalPlaces value that is less than 0: ${fieldsWithNegativeMaxDecimalPlace.join(', ')}.`,
      );
    }
  }
}

function hasEmptyFieldCaption(field: Field): boolean {
  return !field.fieldCaption;
}

export function hasFunctionAndCalculation(field: Field | FilterField): boolean {
  return !!('function' in field && field.function && 'calculation' in field && field.calculation);
}

export function hasFieldCaptionAndCalculation(field: Field | FilterField): boolean {
  return !!(
    'fieldCaption' in field &&
    field.fieldCaption &&
    'calculation' in field &&
    field.calculation
  );
}

function hasNegativeMaxDecimalPlace(field: Field): boolean {
  return field.maxDecimalPlaces !== undefined && field.maxDecimalPlaces < 0;
}
