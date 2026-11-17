import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';
import { z } from 'zod';

import { useRestApi } from '../../../../restApiInstance.js';
import { luidSchema } from '../../../../sdks/routeSafety/ids.js';
import { PulseMetric } from '../../../../sdks/tableau/types/pulse.js';
import { SiteRole } from '../../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../../server.web.js';
import { pulsePaginate } from '../../../../utils/paginate.js';
import { WebTool } from '../../tool.js';
import { constrainPulseMetrics } from '../constrainPulseMetrics.js';

const paramsSchema = {
  pulseMetricDefinitionID: luidSchema,
  limit: z.coerce.number().int().positive().safe().optional(),
  pageSize: z.coerce.number().int().positive().safe().optional(),
  excludeMetricsWithoutFollowers: z.boolean().optional(),
};

export const getListPulseMetricsFromMetricDefinitionIdTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const listPulseMetricsFromMetricDefinitionIdTool = new WebTool({
    server,
    name: 'list-pulse-metrics-from-metric-definition-id',
    minRequiredRole: SiteRole.VIEWER,
    registrationConditions: ['RequiresPulse'],
    description: `
Retrieves a list of published Pulse Metrics from a Pulse Metric Definition using the Tableau REST API.  Use this tool when a user requests to list Tableau Pulse Metrics for a specific Pulse Metric Definition on the current site.

**Parameters:**
- \`pulseMetricDefinitionID\` (required): The ID of the Pulse Metric Definition to list metrics for.  It should be the ID of the Pulse Metric Definition, not the name.  Example: BBC908D8-29ED-48AB-A78E-ACF8A424C8C3
- \`limit\` (optional): Maximum metrics to return, also bounded by the server result limit. Without a limit, follows all REST pages.
- \`pageSize\` (optional): Positive integer metrics per REST request; does not limit the total result.
- \`excludeMetricsWithoutFollowers\` (optional): Set false to include metrics without followers, or true to exclude them. Omission preserves the REST default. Permissions and configured content restrictions still apply.

**Example Usage:**
- List all Pulse Metrics for this Pulse Metric Definition
`,
    paramsSchema,
    annotations: {
      title: 'List Pulse Metrics from Metric Definition ID',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async (
      { pulseMetricDefinitionID, limit, pageSize, excludeMetricsWithoutFollowers },
      extra,
    ): Promise<CallToolResult> => {
      const configWithOverrides = await extra.getConfigWithOverrides();
      return await listPulseMetricsFromMetricDefinitionIdTool.logAndExecute<Array<PulseMetric>>({
        extra,
        args: { pulseMetricDefinitionID, limit, pageSize, excludeMetricsWithoutFollowers },
        callback: async () => {
          return await useRestApi({
            ...extra,
            jwtScopes: listPulseMetricsFromMetricDefinitionIdTool.requiredApiScopes,
            callback: async (restApi) => {
              const maxResultLimit = configWithOverrides.getMaxResultLimit(
                listPulseMetricsFromMetricDefinitionIdTool.name,
              );
              return await pulsePaginate({
                config: {
                  limit: maxResultLimit
                    ? Math.min(maxResultLimit, limit ?? Number.MAX_SAFE_INTEGER)
                    : limit,
                  pageSize,
                },
                getDataFn: async (pageToken, requestedPageSize) => {
                  extra.signal.throwIfAborted();
                  const result = await restApi.pulseMethods.listPulseMetricsFromMetricDefinitionId(
                    pulseMetricDefinitionID,
                    pageToken,
                    requestedPageSize,
                    excludeMetricsWithoutFollowers,
                    extra.signal,
                  );
                  return result.isOk()
                    ? new Ok({ pagination: result.value.pagination, data: result.value.metrics })
                    : result;
                },
              });
            },
          });
        },
        constrainSuccessResult: async (metrics) => {
          return constrainPulseMetrics({
            metrics,
            boundedContext: configWithOverrides.boundedContext,
          });
        },
      });
    },
  });

  return listPulseMetricsFromMetricDefinitionIdTool;
};
