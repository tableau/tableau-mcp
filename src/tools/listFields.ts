import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { getNewRestApiInstanceAsync } from '../restApiInstance.js';
import { Tool } from './tool.js';
import { validateDatasourceLuid } from './validateDatasourceLuid.js';

export const getGraphqlQuery = (datasourceLuid: string): string => `
  query Datasources {
    publishedDatasources(filter: { luid: "${datasourceLuid}" }) {
      name
      description
      datasourceFilters { field { name description } }
      fields { name description }
    }
  }`;

export const listFieldsTool = new Tool({
  name: 'list-fields',
  description:
    "Fetches field metadata (name, description) for the specified datasource via Tableau's Metadata API, reusing the shared get_datasource_query function. Returns a list of field dicts or an error message.",
  paramsSchema: {
    datasourceLuid: z.string().nonempty(),
  },
  annotations: {
    title: 'List Fields',
    readOnlyHint: true,
    openWorldHint: false,
  },
  argsValidator: validateDatasourceLuid,
  callback: async ({ datasourceLuid }): Promise<CallToolResult> => {
    const config = getConfig();
    const query = getGraphqlQuery(datasourceLuid);

    return await listFieldsTool.logAndExecute({
      args: { datasourceLuid },
      callback: async (requestId) => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        const response = await restApi.metadataMethods.graphql(query);
        const published = response.data.publishedDatasources;

        if (published.length) {
          return new Ok(response);
        }

        return new Err('No published datasources in response');
      },
      getErrorText: (requestId: string, error: string) => {
        return JSON.stringify({ requestId, error });
      },
    });
  },
});
