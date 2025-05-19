import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from '../config.js';
import { getNewRestApiInstanceAsync } from '../restApiInstance.js';
import { Tool } from './tool.js';

export const readMetadataTool = new Tool({
  name: 'read-metadata',
  description:
    'Requests metadata for the hard-wired data source. The metadata provides information about the data fields, such as field names, data types, and descriptions.',
  paramsSchema: {},
  callback: async (): Promise<CallToolResult> => {
    const config = getConfig();

    return await readMetadataTool.logAndExecute({
      args: undefined,
      callback: async (requestId) => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        return await restApi.vizqlDataServiceMethods.readMetadata({
          datasource: {
            datasourceLuid: config.datasourceLuid,
          },
        });
      },
    });
  },
});
