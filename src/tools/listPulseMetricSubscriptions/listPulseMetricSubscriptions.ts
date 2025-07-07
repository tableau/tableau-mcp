import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listPulseMetricSubscriptionsTool = new Tool({
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
  paramsSchema: {},
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
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        return new Ok(await restApi.pulseMethods.listPulseMetricSubscriptionsForCurrentUser());
      },
    });
  },
});
