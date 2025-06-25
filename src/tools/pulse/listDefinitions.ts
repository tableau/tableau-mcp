import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  siteName: z.string(),
};

export const getListDefinitionsTool = (server: Server): Tool<typeof paramsSchema> => {
  const listDefinitionsTool = new Tool({
    server,
    name: 'list-metric-definitions',
    description: `Lists the metric definitions configured for a site or, optionally, the details and definition for a specific metric.`,
    paramsSchema,
    annotations: {
      title: 'List Metric Definitions',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ siteName }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await listDefinitionsTool.logAndExecute({
        requestId,
        args: { siteName },
        callback: async () => {
          config.authConfig.siteName = siteName;

          return new Ok(
            await useRestApi(
              config.server,
              config.authConfig,
              requestId,
              server,
              async (restApi) => {
                return await restApi.pulseMethods.listDefinitions();
              },
            ),
          );
        },
      });
    },
  });

  return listDefinitionsTool;
};
