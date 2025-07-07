import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { getNewRestApiInstanceAsync } from '../../../restApiInstance.js';
import { Tool } from '../../tool.js';

export const listPulseMetricsFromMetricDefinitionIdTool = new Tool({
  name: 'list-pulse-metrics-from-metric-definition-id',
  description: `
Retrieves a list of published Pulse Metrics from a Pulse Metric Definition using the Tableau REST API.  Use this tool when a user requests to list Tableau Pulse Metrics for a specific Pulse Metric Definition on the current site.

**Parameters:**
- \`pulseMetricDefinitionID\` (required): The ID of the Pulse Metric Definition to list metrics for.  It should be the ID of the Pulse Metric Definition, not the name.  Example: BBC908D8-29ED-48AB-A78E-ACF8A424C8C3

**Example Usage:**
- List all Pulse Metrics for this Pulse Metric Definition
`,
  paramsSchema: {
    pulseMetricDefinitionID: z.string().length(36),
  },
  annotations: {
    title: 'List Pulse Metrics from Metric Definition ID',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ pulseMetricDefinitionID }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listPulseMetricsFromMetricDefinitionIdTool.logAndExecute({
      requestId,
      args: { pulseMetricDefinitionID },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        return new Ok(
          await restApi.pulseMethods.listPulseMetricsFromMetricDefinitionId(
            pulseMetricDefinitionID,
          ),
        );
      },
    });
  },
});
