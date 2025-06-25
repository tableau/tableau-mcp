import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { useRestApi } from '../../restApiInstance.js';
import { Server } from '../../server.js';
import { Tool } from '../tool.js';

const paramsSchema = {
  siteName: z.string(),
  definitionId: z.string(),
};

export const getListMetricsInDefinitionsTool = (server: Server): Tool<typeof paramsSchema> => {
  const listMetricsInDefinitionsTool = new Tool({
    server,
    name: 'list-metrics-in-definition',
    description: `Lists the metrics contained in a metric definition.`,
    paramsSchema,
    annotations: {
      title: 'List Metric Definitions',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ siteName, definitionId }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();

      return await listMetricsInDefinitionsTool.logAndExecute({
        requestId,
        args: { siteName, definitionId },
        callback: async () => {
          config.authConfig.siteName = siteName;

          return new Ok(
            await useRestApi(
              config.server,
              config.authConfig,
              requestId,
              server,
              async (restApi) => {
                return await restApi.pulseMethods.listMetricsInDefinition(definitionId);
              },
            ),
          );
        },
      });
    },
  });

  return listMetricsInDefinitionsTool;
};
