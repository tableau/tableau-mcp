import { Err, Ok, Result } from 'ts-results-es';
import { z } from 'zod';

import {
  Datasource,
  DataType,
  MetadataResponse,
  QueryParameter,
} from '../../../sdks/tableau/apis/vizqlDataServiceApi.js';
import VizqlDataServiceMethods from '../../../sdks/tableau/methods/vizqlDataServiceMethods.js';
import { Query } from '../queryDatasourceValidator.js';

// TODO: move this type to a separate file
type Datasource = z.infer<typeof Datasource>;

type FieldValidationError = {
  field: string;
  message: string;
};

type ParameterValidationError = {
  parameter: string;
  message: string;
};

type QueryValidationError = FieldValidationError | ParameterValidationError;

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

function validateFieldsAgainstDatasourceMetadata(
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
          message: `The bin field '${field.fieldCaption}' already exists in the datasource, and can not be modified. To create a new bin field, provide a new field caption. To query this field, omit the binSize property.`,
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
          message: `The bin field '${field.fieldCaption}' was provided in the query, but no corresponding measure field was found. To create a new bin field, provide the corresponding measure field in the query.`,
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
          message: `Field '${field.fieldCaption}' was not found in the datasource. Fields must either belong to the datasource or be a new field with a calculation.`,
        });
      }

      continue;
    } else if ('calculation' in field) {
      if ('formula' in matchingField) {
        validationErrors.push({
          field: field.fieldCaption,
          message: `A custom calculation was provided for field '${field.fieldCaption}', but this field already has a calculation assigned to it. To query a preexisting field with a calculation, omit the calculation property. To create a new calculation, provide a new field caption.`,
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
            ![
              'SUM',
              'AVG',
              'MEDIAN',
              'COUNT',
              'COUNTD',
              'MIN',
              'MAX',
              'STDEV',
              'VAR',
              'ATTR',
            ].includes(field.function)
          ) {
            validationErrors.push({
              field: field.fieldCaption,
              message: `The '${field.fieldCaption}' field is of type '${matchingField.dataType}', and the function '${field.function}' can not be applied to fields of this data type.`,
            });
          }
          continue;
        case 'STRING':
        case 'BOOLEAN':
          if (!['MIN', 'MAX', 'COUNT', 'COUNTD', 'ATTR'].includes(field.function)) {
            validationErrors.push({
              field: field.fieldCaption,
              message: `The '${field.fieldCaption}' field is of type '${matchingField.dataType}', and the function '${field.function}' can not be applied to fields of this data type.`,
            });
          }
          continue;
        case 'DATE':
        case 'DATETIME':
          if (!['MIN', 'MAX', 'COUNT', 'COUNTD', 'ATTR'].includes(field.function)) {
            validationErrors.push({
              field: field.fieldCaption,
              message: `The '${field.fieldCaption}' field is of type '${matchingField.dataType}', and the function '${field.function}' can not be applied to fields of this data type.`,
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

function validateParametersAgainstDatasourceMetadata(
  parameters: QueryParameter[],
  datasourceMetadata: MetadataResponse,
  validationErrors: QueryValidationError[],
): void {
  for (const parameter of parameters) {
    const matchingParameter = datasourceMetadata.extraData?.parameters?.find(
      (p) => p.parameterCaption === parameter.name,
    );

    // Parameters used in the query must exist in the datasource metadata.
    if (!matchingParameter) {
      validationErrors.push({
        parameter: parameter.name,
        message: `Parameter '${parameter.name}' was not found in the datasource. Only parameters that are defined in the datasource can be used in a query.`,
      });
      continue;
    }

    switch (matchingParameter.parameterType) {
      case 'ANY_VALUE':
        if (!parameterValueMatchesDataType(parameter.value, matchingParameter.dataType)) {
          validationErrors.push({
            parameter: parameter.name,
            message: `Parameter '${parameter.name}' has a data type of '${matchingParameter.dataType}' but was provided a value that does not match the data type: ${parameter.value}.`,
          });
        }
        break;
      case 'LIST':
        if (!matchingParameter.members.includes(parameter.value)) {
          validationErrors.push({
            parameter: parameter.name,
            message: `Parameter '${parameter.name}' has a value that is not in the list of allowed values for the parameter. The list of allowed values is: ${matchingParameter.members.join(', ')}.`,
          });
        }
        break;
      case 'QUANTITATIVE_DATE':
        if (typeof parameter.value !== 'string' || isNaN(Date.parse(parameter.value))) {
          validationErrors.push({
            parameter: parameter.name,
            message: `Parameter '${parameter.name}' was provided a value that is not a valid date. Dates must use the RFC 3339 standard. Example: 2025-03-14`,
          });
          continue;
        }
        if (
          matchingParameter.minDate &&
          new Date(parameter.value) < new Date(matchingParameter.minDate)
        ) {
          validationErrors.push({
            parameter: parameter.name,
            message: `Parameter '${parameter.name}' was provided a value that is less than the minimum date for the parameter.`,
          });
          continue;
        }
        if (
          matchingParameter.maxDate &&
          new Date(parameter.value) > new Date(matchingParameter.maxDate)
        ) {
          validationErrors.push({
            parameter: parameter.name,
            message: `Parameter '${parameter.name}' was provided a value that is greater than the maximum date for the parameter.`,
          });
          continue;
        }
        break;
      case 'QUANTITATIVE_RANGE':
        if (typeof parameter.value !== 'number') {
          validationErrors.push({
            parameter: parameter.name,
            message: `Parameter '${parameter.name}'. This parameter is a quantitative range parameter, and can only be assigned numerical values.`,
          });
          continue;
        }
        if (matchingParameter.min != undefined && parameter.value < matchingParameter.min) {
          validationErrors.push({
            parameter: parameter.name,
            message: `Parameter '${parameter.name}' was provided a value that is less than the minimum value for the parameter.`,
          });
          continue;
        }
        if (matchingParameter.max != undefined && parameter.value > matchingParameter.max) {
          validationErrors.push({
            parameter: parameter.name,
            message: `Parameter '${parameter.name}' was provided a value that is greater than the maximum value for the parameter.`,
          });
          continue;
        }
        // TODO: account for floating point precision issues.
        if (matchingParameter.step != undefined && parameter.value % matchingParameter.step !== 0) {
          validationErrors.push({
            parameter: parameter.name,
            message: `Parameter '${parameter.name}' was provided a value that is not a multiple of the step value for the parameter.`,
          });
          continue;
        }
        break;
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
  // TODO: Determine when parameter values are nullable.
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
