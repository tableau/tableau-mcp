import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { getNewRestApiInstanceAsync } from '../restApiInstance.js';
import { Tool } from './tool.js';
import { validateDatasourceLuid } from './validateDatasourceLuid.js';

export const readMetadataTool = new Tool({
  name: 'read-metadata',
  description: `This tool wraps the read-metadata endpoint exposed by Tableau VizQL Data Service. It returns basic, high-level metadata for a specified data source.
    It strictly provides the following:
    {
      "fieldName": "string",
      "fieldCaption": "string",
      "dataType": "INTEGER",
      "defaultAggregation": "SUM",
      "logicalTableId": "string"
    }
    This tool is useful for getting a quick overview of the data source, but it does not provide the rich metadata that the list-fields tool provides.
    `,
  paramsSchema: {
    datasourceLuid: z.string().nonempty(),
  },
  annotations: {
    title: 'Read Metadata',
    readOnlyHint: true,
    openWorldHint: false,
  },
  argsValidator: validateDatasourceLuid,
  callback: async ({ datasourceLuid }): Promise<CallToolResult> => {
    const config = getConfig();

    return await readMetadataTool.logAndExecute({
      args: { datasourceLuid },
      callback: async (requestId) => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        return new Ok(
          await restApi.vizqlDataServiceMethods.readMetadata({
            datasource: {
              datasourceLuid,
            },
          }),
        );
      },
    });
  },
});
