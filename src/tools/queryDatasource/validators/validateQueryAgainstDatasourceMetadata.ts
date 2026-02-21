import { Err, Ok, Result } from 'ts-results-es';

import {
  Datasource,
  DataType,
  MetadataResponse,
  Query,
  QueryParameter,
} from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import VizqlDataServiceMethods from '../../../sdks/tableau/methods/vizqlDataServiceMethods.js';

export type FieldValidationError = {
  field: string;
  message: string;
};

export type ParameterValidationError = {
  parameter: string;
  message: string;
};

export type QueryValidationError = FieldValidationError | ParameterValidationError;

export async function validateQueryAgainstDatasourceMetadata(
  query: Query,
  vizqlDataServiceMethods: VizqlDataServiceMethods,
  datasource: Datasource,
): Promise<Result<void, QueryValidationError[]>> {
  const validationErrors: QueryValidationError[] = [];

  try {
    const readMetadataResult = await vizqlDataServiceMethods.readMetadata({
      datasource: {
        datasourceLuid: datasource.datasourceLuid,
      },
    });

    if (readMetadataResult.isErr() || !readMetadataResult.value.data) {
      // Failed requests should not block the query from being executed.
      return Ok.EMPTY;
    }

    validateFieldsAgainstDatasourceMetadata(
      query.fields,
      readMetadataResult.value,
      validationErrors,
    );

    if (query.parameters) {
      validateParametersAgainstDatasourceMetadata(
        query.parameters,
        readMetadataResult.value,
        validationErrors,
      );
    }
  } catch {
    // Failed requests should not block the query from being executed.
    return Ok.EMPTY;
  }

  if (validationErrors.length > 0) {
    return new Err(validationErrors);
  }

  return Ok.EMPTY;
}

export function validateFieldsAgainstDatasourceMetadata(
  fields: Query['fields'],
  datasourceMetadata: MetadataResponse,
  validationErrors: QueryValidationError[],
): void {
  for (const field of fields) {
    // Validate bin fields.
    if ('binSize' in field) {
      // The bin size property is only for new bin fields created as part of the query, it can not be used to override preexisting bin fields.
      const preexistingBinField = datasourceMetadata.data?.find(
        (f) => f.fieldCaption === field.fieldCaption && f.columnClass === 'BIN',
      );

      if (preexistingBinField) {
        validationErrors.push({
          field: field.fieldCaption,
          message: `The bin field '${field.fieldCaption}' has a fixed bin size defined in the datasource and can not be modified. To create a new bin on a field, use the field caption of the measure field you want to group. To use this bin, omit the binSize property.`,
        });
        continue;
      }

      // In order to create a new bin field, the query must also have the corresponding measure field.
      const measureField = fields.find(
        (f) => f.fieldCaption === field.fieldCaption && 'function' in f && f.function,
      );

      if (!measureField) {
        validationErrors.push({
          field: field.fieldCaption,
          message: `The bin field '${field.fieldCaption}' was provided in the query, but no corresponding measure field was found. To create a new bin on a field, use the field caption of the measure field you want to group.`,
        });
      }

      continue;
    }

    const matchingField = datasourceMetadata.data?.find(
      (f) => f.fieldCaption === field.fieldCaption,
    );

    // Field must exist in the datasource metadata, unless it's a custom calculation.
    if (!matchingField) {
      if (!('calculation' in field)) {
        validationErrors.push({
          field: field.fieldCaption,
          message: `Field '${field.fieldCaption}' was not found in the datasource. Fields must either belong to the datasource or provide a custom calculation.`,
        });
      }

      continue;
    } else if ('calculation' in field) {
      if ('formula' in matchingField) {
        validationErrors.push({
          field: field.fieldCaption,
          message: `A custom calculation was provided for field '${field.fieldCaption}', but this field already has a calculation and can not be overwritten. To query this field, omit the calculation property. To create a new calculation, provide a new field caption.`,
        });
      } else {
        validationErrors.push({
          field: field.fieldCaption,
          message: `A custom calculation was provided for field '${field.fieldCaption}', but this field already exists in the datasource. To create a new calculation, provide a new field caption. To query this field, omit the calculation property.`,
        });
      }
      continue;
    }

    // For measure fields, validate that the function applied is valid given the field's data type.
    if ('function' in field) {
      switch (matchingField.dataType) {
        case 'INTEGER':
        case 'REAL':
          if (
            !['SUM', 'AVG', 'MEDIAN', 'COUNT', 'COUNTD', 'MIN', 'MAX', 'STDEV', 'VAR'].includes(
              field.function,
            )
          ) {
            validationErrors.push({
              field: field.fieldCaption,
              message: `The '${field.fieldCaption}' field is of type '${matchingField.dataType}'. The '${field.function}' function can not be applied to fields of this data type.`,
            });
          }
          continue;
        case 'STRING':
        case 'BOOLEAN':
          if (!['MIN', 'MAX', 'COUNT', 'COUNTD'].includes(field.function)) {
            validationErrors.push({
              field: field.fieldCaption,
              message: `The '${field.fieldCaption}' field is of type '${matchingField.dataType}'. The '${field.function}' function can not be applied to fields of this data type.`,
            });
          }
          continue;
        case 'DATE':
        case 'DATETIME':
          if (
            ![
              'MIN',
              'MAX',
              'COUNT',
              'COUNTD',
              'YEAR',
              'QUARTER',
              'MONTH',
              'WEEK',
              'DAY',
              'TRUNC_YEAR',
              'TRUNC_QUARTER',
              'TRUNC_MONTH',
              'TRUNC_WEEK',
              'TRUNC_DAY',
            ].includes(field.function)
          ) {
            validationErrors.push({
              field: field.fieldCaption,
              message: `The '${field.fieldCaption}' field is of type '${matchingField.dataType}'. The '${field.function}' function can not be applied to fields of this data type.`,
            });
          }
          continue;
        default:
          // Ignore SPATIAL and UNKNOWN data types.
          continue;
      }
    }
  }
}

export function validateParametersAgainstDatasourceMetadata(
  parameters: QueryParameter[],
  datasourceMetadata: MetadataResponse,
  validationErrors: QueryValidationError[],
): void {
  for (const parameter of parameters) {
    const matchingParameter = datasourceMetadata.extraData?.parameters?.find(
      (p) => p.parameterCaption === parameter.parameterCaption,
    );

    // Parameters used in the query must exist in the datasource metadata.
    if (!matchingParameter) {
      validationErrors.push({
        parameter: parameter.parameterCaption,
        message: `Parameter '${parameter.parameterCaption}' was not found in the datasource. Only parameters that are defined in the datasource can be used in a query.`,
      });
      continue;
    }

    // Do validation based on the parameter type.
    switch (matchingParameter.parameterType) {
      case 'ANY_VALUE':
        if (!parameterValueMatchesDataType(parameter.value, matchingParameter.dataType)) {
          validationErrors.push({
            parameter: parameter.parameterCaption,
            message: `Parameter '${parameter.parameterCaption}' has '${matchingParameter.dataType}' data type but was provided a value that does not match the data type: ${parameter.value}.`,
          });
        }
        continue;
      case 'LIST':
        if (!matchingParameter.members.some((m) => m.value === parameter.value)) {
          validationErrors.push({
            parameter: parameter.parameterCaption,
            message: `Parameter '${parameter.parameterCaption}' has a value that is not in the list of allowed values for the parameter. The list of allowed values is [${matchingParameter.members.map((m) => m.value).join(', ')}].`,
          });
        }
        continue;
      case 'QUANTITATIVE_DATE':
        if (typeof parameter.value !== 'string' || isNaN(Date.parse(parameter.value))) {
          validationErrors.push({
            parameter: parameter.parameterCaption,
            message: `Parameter '${parameter.parameterCaption}' was provided a value that is not a valid date. Dates must use the RFC 3339 standard. Example: 2025-03-14`,
          });
          continue;
        }
        if (
          matchingParameter.minDate &&
          new Date(parameter.value) < new Date(matchingParameter.minDate)
        ) {
          validationErrors.push({
            parameter: parameter.parameterCaption,
            message: `Parameter '${parameter.parameterCaption}' was provided a value that is less than the minimum allowed date of ${matchingParameter.minDate}.`,
          });
          continue;
        }
        if (
          matchingParameter.maxDate &&
          new Date(parameter.value) > new Date(matchingParameter.maxDate)
        ) {
          validationErrors.push({
            parameter: parameter.parameterCaption,
            message: `Parameter '${parameter.parameterCaption}' was provided a value that is greater than the maximum allowed date of ${matchingParameter.maxDate}.`,
          });
          continue;
        }
        continue;
      case 'QUANTITATIVE_RANGE':
        if (typeof parameter.value !== 'number') {
          validationErrors.push({
            parameter: parameter.parameterCaption,
            message: `Parameter '${parameter.parameterCaption}' is a quantitative range parameter, and can only be assigned numerical values.`,
          });
          continue;
        }
        if (matchingParameter.min != undefined && parameter.value < matchingParameter.min) {
          validationErrors.push({
            parameter: parameter.parameterCaption,
            message: `Parameter '${parameter.parameterCaption}' was provided a value that is less than the minimum allowed value of ${matchingParameter.min}.`,
          });
          continue;
        }
        if (matchingParameter.max != undefined && parameter.value > matchingParameter.max) {
          validationErrors.push({
            parameter: parameter.parameterCaption,
            message: `Parameter '${parameter.parameterCaption}' was provided a value that is greater than the maximum allowed value of ${matchingParameter.max}.`,
          });
          continue;
        }
        continue;
      default:
        // if more parameter types are added, this method will continue without throwing an error.
        continue;
    }
  }
}

function parameterValueMatchesDataType(
  value: QueryParameter['value'],
  dataType: DataType,
): boolean {
  if (value === null) {
    return true;
  }
  switch (dataType) {
    case 'INTEGER':
      return typeof value === 'number' && Number.isInteger(value);
    case 'REAL':
      return typeof value === 'number';
    case 'STRING':
      return typeof value === 'string';
    case 'BOOLEAN':
      return typeof value === 'boolean';
    case 'DATE':
      return typeof value === 'string' && !isNaN(Date.parse(value));
    default:
      // unsupported data type
      return false;
  }
}
