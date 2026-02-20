import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';
import z from 'zod';

import { useRestApi } from '../restApiInstance';
import {
  pulseBundleRequestSchema,
  PulseBundleResponse,
  pulseInsightBundleTypeEnum,
} from '../sdks/tableau/types/pulse';
import { Server } from '../server';
import { GeneratePulseMetricValueInsightBundleError } from '../tools/pulse/generateMetricValueInsightBundle/generatePulseMetricValueInsightBundleTool';
import { getPulseDisabledError } from '../tools/pulse/getPulseDisabledError';
import { AppTool } from './appTool';

const paramsSchema = {
  bundleRequest: pulseBundleRequestSchema,
  bundleType: z.optional(z.enum(pulseInsightBundleTypeEnum)),
  insightGroupType: z.optional(z.string()),
  insightType: z.optional(z.string()),
};

export const getPulseRendererAppTool = (server: Server): AppTool<typeof paramsSchema> => {
  const pulseRendererAppTool = new AppTool({
    server,
    name: 'pulse-renderer',
    title: 'Pulse Renderer',
    description:
      'Render a Pulse insight given an insight bundle. Use this tool to render a Pulse insight in a chat window.',
    paramsSchema,
    callback: async (
      { bundleRequest, bundleType, insightGroupType, insightType },
      extra,
    ): Promise<CallToolResult> => {
      return await pulseRendererAppTool.logAndExecute<
        {
          bundle: PulseBundleResponse;
          insightGroupType: string | undefined;
          insightType: string | undefined;
        },
        GeneratePulseMetricValueInsightBundleError
      >({
        extra,
        args: { bundleRequest, bundleType, insightGroupType, insightType },
        callback: async () => {
          const configWithOverrides = await extra.getConfigWithOverrides();

          const { datasourceIds } = configWithOverrides.boundedContext;
          if (datasourceIds) {
            const datasourceLuid =
              bundleRequest.bundle_request.input.metric.definition.datasource.id;

            if (!datasourceIds.has(datasourceLuid)) {
              return new Err({
                type: 'datasource-not-allowed',
                message: [
                  'The set of allowed metric insights that can be queried is limited by the server configuration.',
                  'Generating the Pulse Metric Value Insight Bundle is not allowed because the definition is derived',
                  `from the data source with LUID ${datasourceLuid}, which is not in the allowed set of data sources.`,
                ].join(' '),
              });
            }
          }

          const result = await useRestApi({
            ...extra,
            jwtScopes: ['tableau:insights:read'],
            callback: async (restApi) =>
              await restApi.pulseMethods.generatePulseMetricValueInsightBundle(
                bundleRequest,
                bundleType ?? 'ban',
              ),
          });

          if (result.isErr()) {
            return new Err({
              type: 'feature-disabled',
              reason: result.error,
            });
          }

          return new Ok({
            bundle: result.value,
            insightGroupType,
            insightType,
          });
        },
        getErrorText: (error) => {
          switch (error.type) {
            case 'feature-disabled':
              return getPulseDisabledError(error.reason);
            case 'datasource-not-allowed':
              return error.message;
          }
        },
      });
    },
  });

  return pulseRendererAppTool;
};
