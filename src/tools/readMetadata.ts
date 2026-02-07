import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../config.js';
import { getNewRestApiInstanceAsync } from '../restApiInstance.js';
import { Tool } from './tool.js';
import { validateDatasourceLuid } from './validateDatasourceLuid.js';

export const readMetadataTool = new Tool({
  name: 'read-metadata',
  description:
    'Requests metadata for the specified data source. The metadata provides information about the data fields, such as field names, data types, and descriptions.',
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
