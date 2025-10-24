import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { pulseMetricDefinitionViewEnum } from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { Tool } from '../../tool.js';
import { constrainPulseDefinitions } from '../constrainPulseDefinitions.js';
import { getPulseDisabledError } from '../getPulseDisabledError.js';

const paramsSchema = {
  metricDefinitionIds: z.array(z.string().length(36)).min(1),
  view: z.optional(z.enum(pulseMetricDefinitionViewEnum)),
};

export const getListPulseMetricDefinitionsFromDefinitionIdsTool = (
  server: Server,
): Tool<typeof paramsSchema> => {
  const listPulseMetricDefinitionsFromDefinitionIdsTool = new Tool({
    server,
    name: 'list-pulse-metric-definitions-from-definition-ids',
    description: `
Retrieves a list of specific Pulse Metric Definitions using the Tableau REST API from a list of metric definition IDs.  Use this tool when a user requests information about specific Pulse Metric Definitions on the current site.

**Parameters:**
- \`metricDefinitionIds\` (required): A list of metric definition IDs to retrieve.
- \`view\` (optional): The range of metrics to return for a definition. The default is 'DEFINITION_VIEW_BASIC' if not specified.
  - \`DEFINITION_VIEW_BASIC\` - Return only the specified metric definition.
  - \`DEFINITION_VIEW_FULL\` - Return the metric definition and the specified number of metrics.
  - \`DEFINITION_VIEW_DEFAULT\` - Return the metric definition and the default metric.

**Example Usage:**
- Can you show me details about Pulse Metric Definition with id 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3'
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3']
- List Pulse Metric Definitions from a list of metric definition IDs:
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3', 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4']
- List these Pulse Metric Definitions with the default view:
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3', 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4'],
    view: 'DEFINITION_VIEW_DEFAULT'
- List these Pulse Metric Definitions with the full view:
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3', 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4'],
    view: 'DEFINITION_VIEW_FULL',
    In the response you will only get up to 5 metrics, so if you want to see more you need to retrieve all the Pulse Metrics from another tool.
- List these Pulse Metric Definitions with the basic view:
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3', 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4'],
    view: 'DEFINITION_VIEW_BASIC'
- See all metrics for these Pulse Metric Definitions with the full view:
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3', 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4'],
    view: 'DEFINITION_VIEW_FULL'
    In the response you will only get up to 5 metrics, so if you want to see more you need to retrieve all the Pulse Metrics from another tool.
`,
    paramsSchema,
    annotations: {
      title: 'List Pulse Metric Definitions from Metric Definition IDs',
      readOnlyHint: true,
      openWorldHint: false,
    },
    callback: async ({ view, metricDefinitionIds }, { requestId }): Promise<CallToolResult> => {
      const config = getConfig();
      return await listPulseMetricDefinitionsFromDefinitionIdsTool.logAndExecute({
        requestId,
        args: { metricDefinitionIds, view },
        callback: async () => {
          return await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:insight_definitions_metrics:read'],
            callback: async (restApi) => {
              return await restApi.pulseMethods.listPulseMetricDefinitionsFromMetricDefinitionIds(
                metricDefinitionIds,
                view,
              );
            },
          });
        },
        constrainSuccessResult: (definitions) =>
          constrainPulseDefinitions({ definitions, boundedContext: config.boundedContext }),
        getErrorText: getPulseDisabledError,
      });
    },
  });

  return listPulseMetricDefinitionsFromDefinitionIdsTool;
};
