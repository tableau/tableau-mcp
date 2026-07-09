import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok, Result } from 'ts-results-es';

import {
  ArgsValidationError,
  DatasourceNotAllowedError,
  McpToolError,
  PulseInsightsDisabledError,
} from '../../../../errors/mcpToolError.js';
import { useRestApi } from '../../../../restApiInstance.js';
import {
  PulseBundleResponse,
  PulseInsightBriefResponse,
} from '../../../../sdks/tableau/types/pulse.js';
import { WebMcpServer } from '../../../../server.web.js';
import { WebTool } from '../../tool.js';
import { validateBriefRequest, validateBundleRequest } from '../validatePulsePayload.js';
import { buildChironRequests, chironInsightRequestSchema } from './requestBuilder.js';

const paramsSchema = {
  request: chironInsightRequestSchema,
};

type ChironInsightResult = {
  output: 'brief' | 'bundle';
  bundleType: 'ban' | 'springboard' | 'basic' | 'detail';
  generatedRequest: Record<string, unknown>;
  response: PulseInsightBriefResponse | PulseBundleResponse;
  provenance: {
    datasourceId: string;
  };
  // Set when the requested brief (AI) output was unavailable on this site and the
  // deterministic bundle was used instead, so callers know why output != requested.
  fallback?: 'brief_unavailable_used_bundle';
};

export const getGenerateChironInsightFromDatasourceContextTool = (
  server: WebMcpServer,
): WebTool<typeof paramsSchema> => {
  const generateChironInsightFromDatasourceContextTool = new WebTool({
    server,
    name: 'generate-chiron-insight-from-datasource-context',
    description: `
Generate a deterministic Pulse insight from Studio datasource/canvas context.

This Chiron wrapper tool validates datasource context, fields, dimensions, and filters, then constructs
inline metric context and calls the appropriate Pulse generate endpoint internally.

Safety behavior:
- Rejects unpublished/local datasources
- Rejects unknown fields and invalid aggregations
- Rejects unvalidated filter values
- Enforces datasource bounds from INCLUDE_DATASOURCE_IDS if configured

Governance behavior:
- Does not require or call Pulse definition/metric list APIs
- Sends no metric_id/definition_id (Chiron has no stored metric or definition); the insight is generated from inline datasource context alone
- Returns the generated request payload with insight response for provenance
`,
    paramsSchema,
    annotations: {
      title: 'Generate Chiron Insight From Datasource Context',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    callback: async ({ request }, extra): Promise<CallToolResult> => {
      return await generateChironInsightFromDatasourceContextTool.logAndExecute<ChironInsightResult>(
        {
          extra,
          args: { request },
          callback: async () => {
            const configWithOverrides = await extra.getConfigWithOverrides();

            if (
              configWithOverrides.boundedContext.datasourceIds &&
              !configWithOverrides.boundedContext.datasourceIds.has(request.datasource.id)
            ) {
              return new DatasourceNotAllowedError(
                'The requested datasource is not in the server-configured allowed datasource set.',
              ).toErr();
            }

            let builtRequest;
            try {
              builtRequest = buildChironRequests(request);
            } catch (error) {
              return new ArgsValidationError(
                error instanceof Error ? error.message : 'Invalid Chiron request context.',
              ).toErr();
            }

            const bundleType = request.insight.bundleType ?? 'ban';

            // Deterministic bundle path (works without Tableau+). Also used as the
            // automatic fallback when the AI brief is not enabled on the site.
            const runBundle = async (
              fallback?: 'brief_unavailable_used_bundle',
            ): Promise<Result<ChironInsightResult, McpToolError>> => {
              const validationError = validateBundleRequest(builtRequest.bundleRequest);
              if (validationError) {
                return new ArgsValidationError(validationError).toErr();
              }

              const bundleResult = await useRestApi({
                ...extra,
                jwtScopes: generateChironInsightFromDatasourceContextTool.requiredApiScopes,
                callback: async (restApi) =>
                  await restApi.pulseMethods.generatePulseMetricValueInsightBundle(
                    builtRequest.bundleRequest,
                    bundleType,
                  ),
              });

              if (bundleResult.isErr()) {
                return bundleResult;
              }

              return new Ok({
                output: 'bundle' as const,
                bundleType,
                generatedRequest: builtRequest.bundleRequest,
                response: bundleResult.value,
                provenance: { datasourceId: request.datasource.id },
                ...(fallback ? { fallback } : {}),
              });
            };

            if (request.insight.output === 'bundle') {
              return await runBundle();
            }

            const validationError = validateBriefRequest(builtRequest.briefRequest);
            if (validationError) {
              return new ArgsValidationError(validationError).toErr();
            }

            const briefResult = await useRestApi({
              ...extra,
              jwtScopes: generateChironInsightFromDatasourceContextTool.requiredApiScopes,
              callback: async (restApi) =>
                await restApi.pulseMethods.generatePulseInsightBrief(builtRequest.briefRequest),
            });

            if (briefResult.isErr()) {
              // On sites without Tableau+ the AI brief endpoint is disabled; fall back
              // to the deterministic bundle so Chiron still returns a governed insight.
              if (briefResult.error instanceof PulseInsightsDisabledError) {
                return await runBundle('brief_unavailable_used_bundle');
              }
              return briefResult;
            }

            return new Ok({
              output: 'brief',
              bundleType,
              generatedRequest: builtRequest.briefRequest,
              response: briefResult.value,
              provenance: {
                datasourceId: request.datasource.id,
              },
            });
          },
          constrainSuccessResult: (result) => ({
            type: 'success',
            result,
          }),
        },
      );
    },
  });

  return generateChironInsightFromDatasourceContextTool;
};
