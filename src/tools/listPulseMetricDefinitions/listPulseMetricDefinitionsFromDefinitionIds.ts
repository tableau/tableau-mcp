import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { pulseMetricDefinitionViewEnum } from '../../sdks/tableau/types/pulse.js';
import { Tool } from '../tool.js';

export const listPulseMetricDefinitionsFromDefinitionIdsTool = new Tool({
  name: 'list-pulse-metric-definitions-from-definition-ids',
  description: `
Retrieves a list of published Pulse Metric Definitions from a specified Tableau site using the Tableau REST API.  Use this tool when a user requests to list Tableau Pulse Metric Definitions on a site.

**Parameters:**
- \`view\` (optional): The range of metrics to return for a definition. The default is 'DEFINITION_VIEW_BASIC' if not specified.
  - \`DEFINITION_VIEW_BASIC\` - Return only the specified metric definition.
  - \`DEFINITION_VIEW_FULL\` - Return the metric definition and the specified number of metrics.
  - \`DEFINITION_VIEW_DEFAULT\` - Return the metric definition and the default metric.
- \`metricDefinitionIds\` (required): A list of metric definition IDs to retrieve.

**Example Usage:**
- List Pulse Metric Definitions from a list of metric definition IDs:
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3', 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4']
- List these Pulse Metric Definitions with the default view:
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3', 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4'],
    view: 'DEFINITION_VIEW_DEFAULT'
- List these Pulse Metric Definitions with the full view:
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3', 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4'],
    view: 'DEFINITION_VIEW_FULL',
    In the response you will only get up to 5 metrics, so if you want to see more you need to use the list-pulse-metrics tool.
- List these Pulse Metric Definitions with the basic view:
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3', 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4'],
    view: 'DEFINITION_VIEW_BASIC'
- See all metrics for these Pulse Metric Definitions with the full view:
    metricDefinitionIds: ['BBC908D8-29ED-48AB-A78E-ACF8A424C8C3', 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4'],
    view: 'DEFINITION_VIEW_FULL'
    In the response you will only get up to 5 metrics, so if you want to see more you need to use the list-pulse-metrics tool.
`,
  paramsSchema: {
    metricDefinitionIds: z.array(z.string().length(36)).min(1),
    view: z.optional(z.enum(pulseMetricDefinitionViewEnum)),
  },
  annotations: {
    title: 'List Pulse Metric Definitions From Metric Definition IDs',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ view, metricDefinitionIds }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listPulseMetricDefinitionsFromDefinitionIdsTool.logAndExecute({
      requestId,
      args: { metricDefinitionIds, view },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        return new Ok(
          await restApi.pulseMethods.listPulseMetricDefinitionsFromMetricDefinitionIds(
            metricDefinitionIds,
            view,
          ),
        );
      },
    });
  },
});
