import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Server } from '../../../server.js';
import { Tool } from '../../tool.js';

const paramsSchema = {};

export const getListPulseMetricSubscriptionsTool = (server: Server): Tool<typeof paramsSchema> => {
  const listPulseMetricSubscriptionsTool = new Tool({
    server,
    name: 'list-pulse-metric-subscriptions',
    description: `
Retrieves a list of published Pulse Metric Subscriptions for the current user using the Tableau REST API.  Use this tool when a user requests to list Tableau Pulse Metric Subscriptions for the current user.

**Example Usage:**  
- List all Pulse Metric Subscriptions for the current user on the current site
- List all of my Pulse Metric Subscriptions

**Note:**
- This tool does not directly provide information about Pulse Metric Definitions.  If you need to know information about Pulse Metric Defintiions associated with your subscriptions you need to:
  1. Retrieve Pulse Metrics from the metric ids returned in the Pulse Metric Subscriptions.
  2. Retrieve Pulse Metric Definitions from the metric definition id returned in the Pulse Metrics.
`,
    paramsSchema,
    annotations: {
      title: 'List Pulse Metric Subscriptions for Current User',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async (_, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      return await listPulseMetricSubscriptionsTool.logAndExecute({
        requestId,
        args: {},
        callback: async () => {
          return new Ok(
            await useRestApi({
              config,
              requestId,
              server,
              jwtScopes: ['tableau:metric_subscriptions:read'],
              callback: async (restApi) => {
                return await restApi.pulseMethods.listPulseMetricSubscriptionsForCurrentUser();
              },
            }),
          );
        },
      });
    },
  });

  return listPulseMetricSubscriptionsTool;
};
