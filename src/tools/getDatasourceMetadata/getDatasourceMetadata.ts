import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { getGraphqlQuery } from '../listFields.js';
import { Tool } from '../tool.js';
import { validateDatasourceLuid } from '../validateDatasourceLuid.js';
import { buildDataDictionary } from './datasourceMetadataUtils.js';

const paramsSchema = {
  datasourceLuid: z.string().nonempty(),
};

export const getGetDatasourceMetadataTool = (server: Server): Tool<typeof paramsSchema> => {
  const getDatasourceMetadataTool = new Tool({
    server,
    name: 'get-datasource-metadata',
    description:
      'TODO: This tool combines the read-metadata and list-fields tools to get metadata for a datasource.',
    paramsSchema,
    annotations: {
      title: 'Get Datasource Metadata',
      readOnlyHint: true,
      openWorldHint: false,
    },
    argsValidator: validateDatasourceLuid,
    callback: async ({ datasourceLuid }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      const query = getGraphqlQuery(datasourceLuid);

      return await getDatasourceMetadataTool.logAndExecute({
        requestId,
        args: { datasourceLuid },
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:content:read', 'tableau:viz_data_service:read'],
              callback: async (restApi) => {
                const readMetadataResult = await restApi.vizqlDataServiceMethods.readMetadata({
                  datasource: {
                    datasourceLuid,
                  },
                });

                // TODO: add guardrails to make sure this request does not fail.
                const listFieldsResult = await restApi.metadataMethods.graphql(query);

                return buildDataDictionary(readMetadataResult, listFieldsResult);
              },
            }),
          );
        },
      });
    },
  });

  return getDatasourceMetadataTool;
};
