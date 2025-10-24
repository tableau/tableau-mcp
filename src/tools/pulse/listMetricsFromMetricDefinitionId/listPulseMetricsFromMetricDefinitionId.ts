import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { PulseDisabledError } from '../../../sdks/tableau/methods/pulseMethods.js';
import { PulseMetric } from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { Tool } from '../../tool.js';
import { constrainPulseMetrics } from '../constrainPulseMetrics.js';
import { getPulseDisabledError } from '../getPulseDisabledError.js';

const paramsSchema = {
  pulseMetricDefinitionID: z.string().length(36),
};

export const getListPulseMetricsFromMetricDefinitionIdTool = (
  server: Server,
): Tool<typeof paramsSchema> => {
  const listPulseMetricsFromMetricDefinitionIdTool = new Tool({
    server,
    name: 'list-pulse-metrics-from-metric-definition-id',
    description: `
Retrieves a list of published Pulse Metrics from a Pulse Metric Definition using the Tableau REST API.  Use this tool when a user requests to list Tableau Pulse Metrics for a specific Pulse Metric Definition on the current site.

**Parameters:**
- \`pulseMetricDefinitionID\` (required): The ID of the Pulse Metric Definition to list metrics for.  It should be the ID of the Pulse Metric Definition, not the name.  Example: BBC908D8-29ED-48AB-A78E-ACF8A424C8C3

**Example Usage:**
- List all Pulse Metrics for this Pulse Metric Definition
`,
    paramsSchema,
    annotations: {
      title: 'List Pulse Metrics from Metric Definition ID',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ pulseMetricDefinitionID }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      return await listPulseMetricsFromMetricDefinitionIdTool.logAndExecute<
        Array<PulseMetric>,
        PulseDisabledError
      >({
        requestId,
        args: { pulseMetricDefinitionID },
        callback: async () => {
          return await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:insight_definitions_metrics:read'],
            callback: async (restApi) => {
              return await restApi.pulseMethods.listPulseMetricsFromMetricDefinitionId(
                pulseMetricDefinitionID,
              );
            },
          });
        },
        constrainSuccessResult: (metrics) =>
          constrainPulseMetrics({ metrics, boundedContext: config.boundedContext }),
        getErrorText: getPulseDisabledError,
      });
    },
  });

  return listPulseMetricsFromMetricDefinitionIdTool;
};
