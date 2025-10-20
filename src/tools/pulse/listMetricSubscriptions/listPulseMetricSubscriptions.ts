import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { Server } from '../../../server.js';
import { Tool } from '../../tool.js';
import { getPulseDisabledError } from '../getPulseDisabledError.js';

const paramsSchema = {};

export const getListPulseMetricSubscriptionsTool = (server: Server): Tool<typeof paramsSchema> => {
  const listPulseMetricSubscriptionsTool = new Tool({
    server,
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
    paramsSchema,
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
          return await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:metric_subscriptions:read'],
            callback: async (restApi) => {
              return await restApi.pulseMethods.listPulseMetricSubscriptionsForCurrentUser();
            },
          });
        },
        constrainSuccessResult: async (subscriptions) => {
          const { datasourceIds } = getConfig().boundedContext;

          if (!datasourceIds) {
            // No datasource IDs to filter by, return all subscriptions.
            return subscriptions;
          }

          if (datasourceIds.size === 0) {
            // No datasource IDs are allowed to be filtered by, return no subscriptions.
            return [];
          }

          const metricsResult = await useRestApi({
            config,
            requestId,
            server,
            jwtScopes: ['tableau:insight_metrics:read'],
            callback: async (restApi) => {
              return await restApi.pulseMethods.listPulseMetricsFromMetricIds(
                subscriptions.map((subscription) => subscription.metric_id),
              );
            },
          });

          if (metricsResult.isErr()) {
            // When there is an error retrieving the metrics, return no subscriptions.
            // This is unlikely to happen, but we don't want to reveal any subscriptions
            // that may have been filtered out.
            return [];
          }

          const allowedMetricIds = new Set(
            metricsResult.value
              .filter((metric) => datasourceIds.has(metric.datasource_luid))
              .map((metric) => metric.id),
          );

          return subscriptions.filter((subscription) =>
            allowedMetricIds.has(subscription.metric_id),
          );
        },
        getErrorText: getPulseDisabledError,
      });
    },
  });

  return listPulseMetricSubscriptionsTool;
};
