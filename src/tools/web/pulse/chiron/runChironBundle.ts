import { Result } from 'ts-results-es';
import { z } from 'zod';

import { McpToolError } from '../../../../errors/mcpToolError.js';
import { useRestApi } from '../../../../restApiInstance.js';
import {
  pulseBundleRequestSchema,
  PulseBundleResponse,
  PulseInsightBundleType,
} from '../../../../sdks/tableau/types/pulse.js';
import { TableauWebRequestHandlerExtra } from '../../toolContext.js';

export async function runChironBundle({
  extra,
  request,
  bundleType = 'ban',
  jwtScopes,
}: {
  extra: TableauWebRequestHandlerExtra;
  request: z.infer<typeof pulseBundleRequestSchema>;
  bundleType?: PulseInsightBundleType;
  jwtScopes: ReadonlyArray<string>;
}): Promise<Result<PulseBundleResponse, McpToolError>> {
  return await useRestApi({
    ...extra,
    jwtScopes,
    callback: async (restApi) =>
      await restApi.pulseMethods.generatePulseMetricValueInsightBundle(request, bundleType),
  });
}
