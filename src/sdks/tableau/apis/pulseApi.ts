import { makeApi, makeEndpoint, ZodiosEndpointDefinitions, ZodiosInstance } from '@zodios/core';
import { z } from 'zod';

import { definitionSchema, metricSchema } from '../types/pulse.js';

const listDefinitionsEndpoint = makeEndpoint({
  method: 'get',
  path: '/pulse/definitions',
  alias: 'listDefinitions',
  description: 'Lists the metric definitions configured for a site.',
  response: z.object({
    definitions: z.array(definitionSchema),
  }),
});

const listMetricsInDefinitionEndpoint = makeEndpoint({
  method: 'get',
  path: '/pulse/definitions/:definitionId/metrics',
  alias: 'listMetricsInDefinition',
  description: 'Lists the metrics contained in a metric definition.',
  response: z.object({
    metrics: z.array(metricSchema),
  }),
});

const pulseApi = makeApi([listDefinitionsEndpoint, listMetricsInDefinitionEndpoint]);
export const pulseApis = [...pulseApi] as const satisfies ZodiosEndpointDefinitions;

export type PulseApiClient = ZodiosInstance<typeof pulseApis>;
