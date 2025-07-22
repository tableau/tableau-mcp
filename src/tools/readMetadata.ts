import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { useRestApi } from '../restApiInstance.js';
import { Server } from '../server.js';
import { getTableauAuthInfo } from '../server/oauth/schemas.js';
import { Tool } from './tool.js';
import { validateDatasourceLuid } from './validateDatasourceLuid.js';

const paramsSchema = {
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
    callback: async ({ datasourceLuid }, { requestId, authInfo }): Promise<CallToolResult> => {
      const config = getConfig();

      return await readMetadataTool.logAndExecute({
        requestId,
        authInfo,
        args: { datasourceLuid },
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              authInfo: getTableauAuthInfo(authInfo),
              callback: async (restApi) => {
                return await restApi.vizqlDataServiceMethods.readMetadata({
                  datasource: {
                    datasourceLuid,
                  },
                });
              },
            }),
          );
        },
      });
    },
  });

  return readMetadataTool;
};
