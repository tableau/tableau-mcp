import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from '../config.js';
import { getNewRestApiInstanceAsync } from '../restApiInstance.js';
import { Tool } from './tool.js';

export const listFieldsTool = new Tool({
  name: 'list-fields',
  description:
    "Fetches field metadata (name, description) for the hard-wired datasource via Tableau's Metadata API, reusing the shared get_datasource_query function. Returns a list of field dicts or an error message.",
  paramsSchema: {},
  callback: async (): Promise<CallToolResult> => {
    const config = getConfig();
    const query = `
    query Datasources {
      publishedDatasources(filter: { luid: "${config.datasourceLuid}" }) {
        name
        description
        datasourceFilters { field { name description } }
        fields { name description }
      }
    }`;

    return await listFieldsTool.logAndExecute({
      args: undefined,
      callback: async (requestId) => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        const response = await restApi.metadataMethods.graphql(query);
        const published = response.data.publishedDatasources;

        if (published.length) {
          return response;
        }

        throw new Error('No published datasources in response', { cause: response });
      },
    });
  },
});
