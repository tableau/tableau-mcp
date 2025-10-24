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
  view: z.optional(z.enum(pulseMetricDefinitionViewEnum)),
};

export const getListAllPulseMetricDefinitionsTool = (server: Server): Tool<typeof paramsSchema> => {
  const listAllPulseMetricDefinitionsTool = new Tool({
    server,
    name: 'list-all-pulse-metric-definitions',
    description: `
Retrieves a list of all published Pulse Metric Definitions using the Tableau REST API.  Use this tool when a user requests to list all Tableau Pulse Metric Definitions on the current site.

**Parameters:**
- \`view\` (optional): The range of metrics to return for a definition. The default is 'DEFINITION_VIEW_BASIC' if not specified.
  - \`DEFINITION_VIEW_BASIC\` - Return only the specified metric definition.
  - \`DEFINITION_VIEW_FULL\` - Return the metric definition and the specified number of metrics.
  - \`DEFINITION_VIEW_DEFAULT\` - Return the metric definition and the default metric.

**Example Usage:**
- List all Pulse Metric Definitions on the current site
- List all Pulse Metric Definitions on the current site with the default view:
    view: 'DEFINITION_VIEW_DEFAULT'
- List all Pulse Metric Definitions on the current site with the full view:
    view: 'DEFINITION_VIEW_FULL'
    In the response you will only get up to 5 metrics, so if you want to see more you need to retrieve all the Pulse Metrics from another tool.
- List all Pulse Metric Definitions on the current site with the basic view:
    view: 'DEFINITION_VIEW_BASIC'
- See all metrics for my Pulse Metric Definitions:
    view: 'DEFINITION_VIEW_FULL'
    In the response you will only get up to 5 metrics, so if you want to see more you need to retrieve all the Pulse Metrics from another tool.
`,
    paramsSchema,
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
          return await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:insight_definitions_metrics:read'],
            callback: async (restApi) => {
              return await restApi.pulseMethods.listAllPulseMetricDefinitions(view);
            },
          });
        },
        constrainSuccessResult: (definitions) =>
          constrainPulseDefinitions({ definitions, boundedContext: config.boundedContext }),
        getErrorText: getPulseDisabledError,
      });
    },
  });

  return listAllPulseMetricDefinitionsTool;
};
