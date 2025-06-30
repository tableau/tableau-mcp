import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { Tool } from '../tool.js';

export const listPulseMetricsFromMetricIdsTool = new Tool({
  name: 'list-pulse-metrics-from-metric-ids',
  description: `
Retrieves a list of published Pulse Metrics from a list of metric IDs on a specified Tableau site using the Tableau REST API.  Use this tool when a user requests to list Tableau Pulse Metrics for a list of metric IDs on a site.

**Parameters:**
- \`metricIds\` (required): The list of Pulse Metric IDs to list metrics for.  It should be the list of metric IDs, not the names or metric definition ids.  Example: ['CF32DDCC-362B-4869-9487-37DA4D152552', 'CF32DDCC-362B-4869-9487-37DA4D152553']
   - For data returned from list-pulse-metric-subscriptions, use the metric_id field.

**Example Usage:**
- List all Pulse Metrics from a list of Pulse Metric IDs

**Note:**
- This tool is recommended for use with list-pulse-metric-subscriptions.  If you need a valid datasource id, you may need to get it from the datasource_id field of the datasource object returned from list-datasources.
`,
  paramsSchema: {
    metricIds: z.array(z.string().length(36)),
  },
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
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        return new Ok(await restApi.pulseMethods.listPulseMetricsFromMetricIds(metricIds));
      },
    });
  },
});
