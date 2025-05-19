import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { getNewRestApiInstanceAsync } from '../restApiInstance.js';
import { Field } from './queryDatasource/querySchemas.js';
import { getToolCallback, Tool } from './tool.js';

const DatasourceQuery = z.object({
  fields: z.array(Field),
});

const queryDatasourceToolDescription = `
Requests relevant data from a datasource using a query.
The "read-metadata" tool provides the context required to construct the datasourceQuery parameter, so make sure to use it before running this tool.
The metadata object obtained from the "read-metadata" tool contains information on a datasource in the form of an array of JSON objects that contain information on each field in the datasource.

Parameters:
- datasourceQuery: A query object that specifies the fields to be retrieved from the datasource.

datasourceQuery is a JSON object that contains the following properties:
- fields: An array of field objects to be used in the query.

Each field object has the following properties:
- fieldCaption: An identifier for the field to be used in the query.
- function: An optional property that specifies a function to be applied to the field.
- sortDirection: An optional property that specifies the direction of the sort the field.

The fieldCaption must be a valid field caption from the metadata object that was returned by the "read-metadata" tool.
Some functions are limited to certain field data types. The data type for a field can be found in the metadata object that was returned by the "read-metadata" tool.
Here is a list of valid data types for a given field:
- INTEGER : Denotes a whole number.
- REAL : Denotes a decimal number.
- STRING : Denotes a string of characters.
- DATETIME : Denotes a date and time.
- BOOLEAN : Denotes a true or false value.
- DATE : Denotes a date.
- SPATIAL : Denotes a spatial object.

Here is a list of allowed functions:
- SUM : returns the sum of all values in the field. SUM can only be used on numeric fields (INTEGER, REAL).
- AVG : returns the average of all values in the field. AVG can only be used on numeric fields (INTEGER, REAL).
- MEDIAN : returns the median of all values in the field. MEDIAN can only be used on numeric fields (INTEGER, REAL).
- COUNT : returns the number of values in the field. COUNT can be used on any field type.
- COUNTD : returns the number of distinct values in the field. Null values are not included in the count. COUNTD can be used on any field type.
- MIN : returns the minimum value in the field. For string fields, the minimum value is the lexicographically smallest value. For date fields, the minimum value is the earliest date. For numeric fields, the minimum value is the smallest numeric value.
- MAX : returns the maximum value in the field. For string fields, the maximum value is the lexicographically largest value. For date fields, the maximum value is the latest date. For numeric fields, the maximum value is the largest numeric value.
- STDEV : returns the standard deviation of all values in the field. STDEV can only be used on numeric fields (INTEGER, REAL).
- VAR : returns the variance of all values in the field. VAR can only be used on numeric fields (INTEGER, REAL).
- COLLECT : returns an array of all values in the field. COLLECT can only be used with spatial fields (SPATIAL).
- YEAR : returns the year for each date in the field. YEAR can only be used on date fields (DATETIME, DATE).
- QUARTER : returns the quarter for each date in the field. QUARTER can only be used on date fields (DATETIME, DATE).
- MONTH : returns the month for each date in the field. MONTH can only be used on date fields (DATETIME, DATE).
- WEEK : returns the week for each date in the field. WEEK can only be used on date fields (DATETIME, DATE).
- DAY : returns the day for each date in the field. DAY can only be used on date fields (DATETIME, DATE).
- TRUNC_YEAR : returns the year for each date in the field in a truncated format. TRUNC_YEAR can only be used on date fields (DATETIME, DATE).
- TRUNC_QUARTER : returns the quarter for each date in the field in a truncated format. TRUNC_QUARTER can only be used on date fields (DATETIME, DATE).
- TRUNC_MONTH : returns the month for each date in the field in a truncated format. TRUNC_MONTH can only be used on date fields (DATETIME, DATE).
- TRUNC_WEEK : returns the week for each date in the field in a truncated format. TRUNC_WEEK can only be used on date fields (DATETIME, DATE).
- TRUNC_DAY : returns the day for each date in the field in a truncated format. TRUNC_DAY can only be used on date fields (DATETIME, DATE).

The sortDirection must be one of the following:
- ASC : ascending order.
- DESC : descending order.
`;

export const queryDatasourceTool = new Tool({
  name: 'query-datasource',
  description: queryDatasourceToolDescription,
  paramsSchema: { datasourceQuery: DatasourceQuery },
  callback: async ({ datasourceQuery }): Promise<CallToolResult> => {
    const config = getConfig();
    return await getToolCallback(async (requestId) => {
      const datasource = { datasourceLuid: config.datasourceLuid };
      const options = {
        returnFormat: 'OBJECTS',
        debug: false,
        disaggregate: false,
      } as const;

      const queryRequest = {
        datasource,
        query: datasourceQuery,
        options,
      };

      const restApi = await getNewRestApiInstanceAsync(config.server, config.authConfig, requestId);
      return await restApi.vizqlDataServiceMethods.queryDatasource(queryRequest);
    });
  },
});
