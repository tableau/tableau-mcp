import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { getConfig } from '../../config.js';
import { getNewRestApiInstanceAsync } from '../../restApiInstance.js';
import { pulseMetricDefinitionViewEnum } from '../../sdks/tableau/types/pulse.js';
import { Tool } from '../tool.js';

export const listAllPulseMetricDefinitionsTool = new Tool({
  name: 'list-all-pulse-metric-definitions',
  description: `
Retrieves a list of published Pulse Metric Definitions from a specified Tableau site using the Tableau REST API.  Use this tool when a user requests to list Tableau Pulse Metric Definitions on a site.

**Parameters:**
- \`view\` (optional): The range of metrics to return for a definition. The default is 'DEFINITION_VIEW_BASIC' if not specified.
  - \`DEFINITION_VIEW_BASIC\` - Return only the specified metric definition.
  - \`DEFINITION_VIEW_FULL\` - Return the metric definition and the specified number of metrics.
  - \`DEFINITION_VIEW_DEFAULT\` - Return the metric definition and the default metric.

**Example Usage:**
- List all Pulse Metric Definitions on a site
- List all Pulse Metric Definitions on a site with the default view:
    view: 'DEFINITION_VIEW_DEFAULT'
- List all Pulse Metric Definitions on a site with the full view:
    view: 'DEFINITION_VIEW_FULL'
    In the response you will only get up to 5 metrics, so if you want to see more you need to use the list-pulse-metrics tool.
- List all Pulse Metric Definitions on a site with the basic view:
    view: 'DEFINITION_VIEW_BASIC'
- See all metrics for my Pulse Metric Definitions:
    view: 'DEFINITION_VIEW_FULL'
    In the response you will only get up to 5 metrics, so if you want to see more you need to use the list-pulse-metrics tool.
`,
  paramsSchema: {
    view: z.optional(z.enum(pulseMetricDefinitionViewEnum)),
  },
  annotations: {
    title: 'List All Pulse Metric Definitions',
    readOnlyHint: true,
    openWorldHint: false,
  },
  callback: async ({ view }, { requestId }): Promise<CallToolResult> => {
    const config = getConfig();
    return await listAllPulseMetricDefinitionsTool.logAndExecute({
      requestId,
      args: { view },
      callback: async () => {
        const restApi = await getNewRestApiInstanceAsync(
          config.server,
          config.authConfig,
          requestId,
        );
        return new Ok(await restApi.pulseMethods.listAllPulseMetricDefinitions(view));
      },
    });
  },
});
