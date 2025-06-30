import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listPulseMetricSubscriptionsTool = new Tool({
  name: 'list-pulse-metric-subscriptions',
  description: `
Retrieves a list of published Pulse Metric Subscriptions for the current user on a specified Tableau site using the Tableau REST API.  Use this tool when a user requests to list Tableau Pulse Metric Subscriptions for the current user on a site.

**Example Usage:**
- List all Pulse Metric Subscriptions for the current user on a site
- List all of my Pulse Metric Subscriptions
`,
  paramsSchema: {},
  annotations: {
    title: 'List Pulse Metric Subscriptions',
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
