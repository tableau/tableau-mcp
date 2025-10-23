import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Server } from '../../../server.js';
import { Tool } from '../../tool.js';
import { constrainPulseMetrics } from '../constrainPulseMetrics.js';
import { getPulseDisabledError } from '../getPulseDisabledError.js';

const paramsSchema = {
  metricIds: z.array(z.string().length(36)),
};

export const getListPulseMetricsFromMetricIdsTool = (server: Server): Tool<typeof paramsSchema> => {
  const listPulseMetricsFromMetricIdsTool = new Tool({
    server,
    name: 'list-pulse-metrics-from-metric-ids',
    description: `
Retrieves a list of published Pulse Metrics from a list of metric IDs using the Tableau REST API.  Use this tool when a user requests to list Tableau Pulse Metrics for a list of metric IDs on the current site.

**Parameters:**
- \`metricIds\` (required): The list of Pulse Metric IDs to list metrics for.  It should be the list of metric IDs, not the names or metric definition ids.  Example: ['CF32DDCC-362B-4869-9487-37DA4D152552', 'CF32DDCC-362B-4869-9487-37DA4D152553']
   - For data in a Pulse Metric Subscription, use the metric_id field.

**Example Usage:**
- List all Pulse Metrics from a list of Pulse Metric IDs

**Note:**
- This tool is recommended for use with data in Pulse Metric Subscriptions.
- 00000000-0000-0000-0000-000000000000 is not a valid datasource id.
- If you need a valid datasource id, you may need to retrieve the Pulse Metric Definition for the Pulse Metric which should have a valid datasource information.
`,
    paramsSchema,
    annotations: {
      title: 'List Pulse Metrics from Metric IDs',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ metricIds }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      return await listPulseMetricsFromMetricIdsTool.logAndExecute({
        requestId,
        args: { metricIds },
        callback: async () => {
          return await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:insight_metrics:read'],
            callback: async (restApi) => {
              return await restApi.pulseMethods.listPulseMetricsFromMetricIds(metricIds);
            },
          });
        },
        constrainSuccessResult: (metrics) =>
          constrainPulseMetrics({ metrics, boundedContext: config.boundedContext }),
        getErrorText: getPulseDisabledError,
      });
    },
  });

  return listPulseMetricsFromMetricIdsTool;
};
