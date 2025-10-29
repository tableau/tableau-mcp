import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { BoundedContext, getConfig } from '../../../config.js';
import { useRestApi } from '../../../restApiInstance.js';
import { PulseMetricSubscription } from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';
import { RestApiArgs } from '../../resourceAccessChecker.js';
import { ConstrainedResult, Tool } from '../../tool.js';
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
          return await constrainPulseMetricSubscriptions({
            subscriptions,
            boundedContext: config.boundedContext,
            restApiArgs: { config, requestId, server },
          });
        },
        getErrorText: getPulseDisabledError,
      });
    },
  });

  return listPulseMetricSubscriptionsTool;
};

export async function constrainPulseMetricSubscriptions({
  subscriptions,
  boundedContext,
  restApiArgs,
}: {
  subscriptions: Array<PulseMetricSubscription>;
  boundedContext: BoundedContext;
  restApiArgs: RestApiArgs;
}): Promise<ConstrainedResult<Array<PulseMetricSubscription>>> {
  if (subscriptions.length === 0) {
    return {
      type: 'empty',
      message:
        'No Pulse Metric Subscriptions were found. Either none exist or you do not have permission to view them.',
    };
  }

  const { datasourceIds } = boundedContext;

  if (!datasourceIds) {
    // No datasource IDs to filter by, return all subscriptions.
    return {
      type: 'success',
      result: subscriptions,
    };
  }

  const { config, requestId, server } = restApiArgs;
  try {
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
      return {
        type: 'error',
        message: [
          'The set of allowed Pulse Metric Subscriptions that can be queried is limited by the server configuration.',
          'While Pulse Metric Subscriptions were found, an error occurred while retrieving information about them to determine if they are allowed to be viewed.',
          getExceptionMessage(metricsResult.error),
        ].join(' '),
      };
    }

    const allowedMetricIds = new Set(
      metricsResult.value
        .filter((metric) => datasourceIds.has(metric.datasource_luid))
        .map((metric) => metric.id),
    );

    subscriptions = subscriptions.filter((subscription) =>
      allowedMetricIds.has(subscription.metric_id),
    );

    if (subscriptions.length === 0) {
      return {
        type: 'empty',
        message: [
          'The set of allowed Pulse Metric Subscriptions that can be queried is limited by the server configuration.',
          'While Pulse Metric Subscriptions were found, they were all filtered out by the server configuration.',
        ].join(' '),
      };
    }

    return {
      type: 'success',
      result: subscriptions,
    };
  } catch (error) {
    return {
      type: 'error',
      message: [
        'The set of allowed Pulse Metric Subscriptions that can be queried is limited by the server configuration.',
        'While Pulse Metric Subscriptions were found, an error occurred while retrieving information about them to determine if they are allowed to be viewed.',
        getExceptionMessage(error),
      ].join(' '),
    };
  }
}
