import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { useRestApi } from '../restApiInstance.js';
import { Server } from '../server.js';
import { Tool } from './tool.js';
import { validateDatasourceLuid } from './validateDatasourceLuid.js';

const paramsSchema = {
  siteName: z.string(),
  datasourceLuid: z.string().nonempty(),
};

export const getReadMetadataTool = (server: Server): Tool<typeof paramsSchema> => {
  const readMetadataTool = new Tool({
    server,
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
    paramsSchema,
    annotations: {
      title: 'Read Metadata',
      readOnlyHint: true,
      openWorldHint: false,
    },
    argsValidator: validateDatasourceLuid,
    callback: async ({ siteName, datasourceLuid }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      config.authConfig.siteName = siteName;

      return await readMetadataTool.logAndExecute({
        requestId,
        args: { siteName, datasourceLuid },
        callback: async () => {
          config.authConfig.siteName = siteName;

          return new Ok(
            await useRestApi(
              config.server,
              config.authConfig,
              requestId,
              server,
              async (restApi) => {
                return await restApi.vizqlDataServiceMethods.readMetadata({
                  datasource: {
                    datasourceLuid,
                  },
                });
              },
            ),
          );
        },
      });
    },
  });

  return readMetadataTool;
};
