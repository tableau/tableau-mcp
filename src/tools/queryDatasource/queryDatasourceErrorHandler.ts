/* v8 ignore start -- Exhaustive tests have limited value for this file */

import { TableauMCPError } from '../../errors/error.js';

/**
 * Enriches a tableau-error TableauMCPError with human-readable condition and details
 * based on the Tableau VizQL Data Service error code.
 *
 * @param {TableauMCPError} error
 * @returns {TableauMCPError}
 * @see https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_error_codes.html
 */
export function handleQueryDatasourceError(
  errorType: string,
  errorMessage: string,
  errorStatusCode: number,
  errorTableauStatusCode: string | undefined,
): TableauMCPError {
  let condition: string | undefined;
  let details: string | undefined;

  switch (errorTableauStatusCode) {
    case '400000':
      condition = 'Bad request';
      details = 'The content of the request body is invalid. Check for missing or incomplete JSON.';
      break;
    case '400800':
      condition = 'Invalid formula for calculation';
      details =
        'Invalid custom calculation syntax. For help, see https://help.tableau.com/current/pro/desktop/en-us/functions_operators.htm';
      break;
    case '400802':
      condition = 'Invalid API request';
      details = "The incoming request isn't valid per the OpenAPI specification.";
      break;
    case '400803':
      condition = 'Validation failed';
      details = "The incoming request isn't valid per the validation rules.";
      break;
    case '400804':
      condition = 'Response too large';
      details = 'The response value exceeds the limit. You must apply a filter in your request.';
      break;
    case '401001':
      condition = 'Login error';
      details = 'The login failed for the given user.';
      break;
    case '401002':
      condition = 'Invalid authorization credentials';
      details = 'The provided auth token is formatted incorrectly.';
      break;
    case '403157':
      condition = 'Feature disabled';
      details = 'The feature is disabled.';
      break;
    case '403800':
      condition = 'API access permission denied';
      details =
        "The user doesn't have API Access granted on the given data source. Set the API Access capability for the given data source to Allowed. For help, see https://help.tableau.com/current/online/en-us/permissions_capabilities.htm";
      break;
    case '404934':
      condition = 'Unknown field';
      details = "The requested field doesn't exist.";
      break;
    case '404950':
      condition = 'API endpoint not found';
      details = "The request endpoint doesn't exist.";
      break;
    case '408000':
      condition = 'Request timeout';
      details = 'The request timed out.';
      break;
    case '409000':
      condition = 'User already on site';
      details = 'HTTP status conflict.';
      break;
    case '429000':
      condition = 'Too many requests';
      details =
        'Too many requests in the allotted amount of time. For help, see https://help.tableau.com/current/api/vizql-data-service/en-us/docs/vds_limitations.html#licensing-and-data-transfer';
      break;
    case '500000':
      condition = 'Internal server error';
      details = 'The request could not be completed.';
      break;
    case '500810':
      condition = 'VDS empty table response';
      details = 'The underlying data engine returned empty data value response.';
      break;
    case '500811':
      condition = 'VDS missing table';
      details = 'The underlying data engine returned empty metadata associated with response.';
      break;
    case '500812':
      condition = 'Error while processing an error';
      details = 'Internal processing error.';
      break;
    case '501000':
      condition = 'Not implemented';
      details = "Can't find response from upstream server.";
      break;
    case '503800':
      condition = 'VDS unavailable';
      details = 'The underlying data engine is unavailable.';
      break;
    case '503801':
      condition = 'VDS discovery error';
      details = "The upstream service can't be found.";
      break;
    case '504000':
      condition = 'Gateway timeout';
      details = 'The upstream service response timed out.';
      break;
  }

  return new TableauMCPError(
    errorType,
    errorMessage,
    errorStatusCode,
    Number(errorTableauStatusCode),
    condition,
    details,
  );
}
/* v8 ignore stop */
