/* v8 ignore start -- Exhaustive tests have limited value for this file */

import { TableauError } from '../../sdks/tableau/apis/vizqlDataServiceApi.js';

type TableauErrorDetail = TableauError & Partial<{ condition: string; details: string }>;

/**
 * Adds additional context to the VizQl Data Service errors.
 *
 * @param {TableauError} error - The error object
 * @returns {*}  {TableauErrorDetail} - The error object with additional context
 * @see https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_error_codes.html
 */
export function handleQueryDatasourceError(error: TableauError): TableauErrorDetail {
  const errorDetail: TableauErrorDetail = {
    ...error,
  };

  switch (error.errorCode) {
    case '400000':
      errorDetail.condition = 'Bad request';
      errorDetail.details =
        'The content of the request body is invalid. Check for missing or incomplete JSON.';
      break;
    case '400800':
      errorDetail.condition = 'Invalid formula for calculation';
      errorDetail.details =
        'Invalid custom calculation syntax. For help, see https://help.tableau.com/current/pro/desktop/en-us/functions_operators.htm';
      break;
    case '400802':
      errorDetail.condition = 'Invalid API request';
      errorDetail.details = "The incoming request isn't valid per the OpenAPI specification.";
      break;
    case '400803':
      errorDetail.condition = 'Validation failed';
      errorDetail.details = "The incoming request isn't valid per the validation rules.";
      break;
    case '400804':
      errorDetail.condition = 'Response too large';
      errorDetail.details =
        'The response value exceeds the limit. You must apply a filter in your request.';
      break;
    case '401001':
      errorDetail.condition = 'Login error';
      errorDetail.details = 'The login failed for the given user.';
      break;
    case '401002':
      errorDetail.condition = 'Invalid authorization credentials';
      errorDetail.details = 'The provided auth token is formatted incorrectly.';
      break;
    case '403157':
      errorDetail.condition = 'Feature disabled';
      errorDetail.details = 'The feature is disabled.';
      break;
    case '403800':
      errorDetail.condition = 'API access permission denied';
      errorDetail.details =
        "The user doesn't have API Access granted on the given data source. Set the API Access capability for the given data source to Allowed. For help, see https://help.tableau.com/current/online/en-us/permissions_capabilities.htm";
      break;
    case '404934':
      errorDetail.condition = 'Unknown field';
      errorDetail.details = "The requested field doesn't exist.";
      break;
    case '404950':
      errorDetail.condition = 'API endpoint not found';
      errorDetail.details = "The request endpoint doesn't exist.";
      break;
    case '408000':
      errorDetail.condition = 'Request timeout';
      errorDetail.details = 'The request timed out.';
      break;
    case '409000':
      errorDetail.condition = 'User already on site';
      errorDetail.details = 'HTTP status conflict.';
      break;
    case '429000':
      errorDetail.condition = 'Too many requests';
      errorDetail.details =
        'Too many requests in the allotted amount of time. For help, see https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_limitations.html#licensing-and-data-transfer';
      break;
    case '500000':
      errorDetail.condition = 'Internal server error';
      errorDetail.details = 'The request could not be completed.';
      break;
    case '500810':
      errorDetail.condition = 'VDS empty table response';
      errorDetail.details = 'The underlying data engine returned empty data value response.';
      break;
    case '500811':
      errorDetail.condition = 'VDS missing table';
      errorDetail.details =
        'The underlying data engine returned empty metadata associated with response.';
      break;
    case '500812':
      errorDetail.condition = 'Error while processing an error';
      errorDetail.details = 'Internal processing error.';
      break;
    case '501000':
      errorDetail.condition = 'Not implemented';
      errorDetail.details = "Can't find response from upstream server.";
      break;
    case '503800':
      errorDetail.condition = 'VDS unavailable';
      errorDetail.details = 'The underlying data engine is unavailable.';
      break;
    case '503801':
      errorDetail.condition = 'VDS discovery error';
      errorDetail.details = "The upstream service can't be found.";
      break;
    case '504000':
      errorDetail.condition = 'Gateway timeout';
      errorDetail.details = 'The upstream service response timed out.';
      break;
  }

  return errorDetail;
}
/* v8 ignore stop */
