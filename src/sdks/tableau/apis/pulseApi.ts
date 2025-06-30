import { makeApi, makeEndpoint, ZodiosEndpointDefinitions } from '@zodios/core';
import { z } from 'zod';

const pulseMetadataSchema = z.object({
  name: z.string(),
  id: z.string(),
});

const pulseDatasourceSchema = z.object({
  id: z.string(),
});

const pulseSpecificationSchema = z.object({
  datasource: pulseDatasourceSchema,
});

export const pulseMetricSchema = z.object({
  id: z.string(),
  is_default: z.boolean(),
  is_followed: z.boolean(),
});

export const pulseMetricDefinitionSchema = z.object({
  metadata: pulseMetadataSchema,
  specification: pulseSpecificationSchema,
  metrics: z.array(pulseMetricSchema),
});

export const pulseMetricSubscriptionSchema = z.object({
  id: z.string(),
  metric_id: z.string(),
});

export const pulseMetricDefinitionViewEnum = [
  'DEFINITION_VIEW_BASIC',
  'DEFINITION_VIEW_FULL',
  'DEFINITION_VIEW_DEFAULT',
] as const;
export type PulseMetricDefinitionView = (typeof pulseMetricDefinitionViewEnum)[number];

export type PulseMetricDefinition = z.infer<typeof pulseMetricDefinitionSchema>;
export type PulseMetric = z.infer<typeof pulseMetricSchema>;
export type PulseMetricSubscription = z.infer<typeof pulseMetricSubscriptionSchema>;

const listAllPulseMetricDefinitionsRestEndpoint = makeEndpoint({
  method: 'get',
  path: '/pulse/definitions',
  alias: 'listAllPulseMetricDefinitions',
  description: 'Returns a list of all published Pulse Metric Definitions on the specified site.',
  parameters: [
    {
      name: 'view',
      type: 'Query',
      schema: z.optional(z.enum(pulseMetricDefinitionViewEnum)),
      description: `The range of metrics to return for a definition. The default is 'DEFINITION_VIEW_BASIC' if not specified.
        - 'DEFINITION_VIEW_BASIC' - Return only the specified metric definition.
        - 'DEFINITION_VIEW_FULL' - Return the metric definition and the specified number of metrics.
        - 'DEFINITION_VIEW_DEFAULT' - Return the metric definition and the default metric.`,
    },
  ],
  response: z.object({
    definitions: z.array(pulseMetricDefinitionSchema),
  }),
});

const listPulseMetricDefinitionsFromMetricDefinitionIdsRestEndpoint = makeEndpoint({
  method: 'post',
  path: '/pulse/definitions%3AbatchGet',
  alias: 'listPulseMetricDefinitionsFromMetricDefinitionIds',
  description:
    'Returns a list of published Pulse Metric Definitions from a list of metric definition IDs.',
  parameters: [
    {
      name: 'definition_ids',
      type: 'Body',
      schema: z.object({ definition_ids: z.array(z.string().nonempty()).min(1) }),
      description: 'A list of metric definition IDs to retrieve.',
    },
    {
      name: 'view',
      type: 'Query',
      schema: z.optional(z.enum(pulseMetricDefinitionViewEnum)),
      description: `The range of metrics to return for a definition. The default is 'DEFINITION_VIEW_BASIC' if not specified.
        - 'DEFINITION_VIEW_BASIC' - Return only the specified metric definition.
        - 'DEFINITION_VIEW_FULL' - Return the metric definition and the specified number of metrics.
        - 'DEFINITION_VIEW_DEFAULT' - Return the metric definition and the default metric.`,
    },
  ],
  response: z.object({
    definitions: z.array(pulseMetricDefinitionSchema),
  }),
});

const listPulseMetricsFromMetricDefinitionIdRestEndpoint = makeEndpoint({
  method: 'get',
  path: '/pulse/definitions/:pulseMetricDefinitionID/metrics',
  alias: 'listPulseMetricsFromMetricDefinitionId',
  description: 'Returns a list of published Pulse Metrics for a specific Pulse Metric Definition.',
  parameters: [
    {
      name: 'pulseMetricDefinitionID',
      type: 'Path',
      schema: z.string().nonempty(),
    },
  ],
  response: z.object({
    metrics: z.array(pulseMetricSchema),
    total_available: z.number(),
  }),
});

const listPulseMetricsFromMetricIdsRestEndpoint = makeEndpoint({
  method: 'post',
  path: '/pulse/metrics%3AbatchGet',
  alias: 'listPulseMetricsFromMetricIds',
  description: 'Returns a list of Pulse Metrics for a list of metric IDs.',
  parameters: [
    {
      name: 'metric_ids',
      type: 'Body',
      schema: z.object({ metric_ids: z.array(z.string().nonempty()) }),
    },
  ],
  response: z.object({
    metrics: z.array(pulseMetricSchema),
  }),
});

const listPulseMetricSubscriptionsForCurrentUserRestEndpoint = makeEndpoint({
  method: 'get',
  path: '/pulse/subscriptions',
  alias: 'listPulseMetricSubscriptionsForCurrentUser',
  description: 'Returns a list of Pulse Subscriptions for the current user.',
  parameters: [
    {
      name: 'user_id',
      type: 'Query',
      schema: z.string().nonempty(),
    },
  ],
  response: z.object({
    subscriptions: z.array(pulseMetricSubscriptionSchema),
  }),
});

const pulseApi = makeApi([
  listAllPulseMetricDefinitionsRestEndpoint,
  listPulseMetricDefinitionsFromMetricDefinitionIdsRestEndpoint,
  listPulseMetricsFromMetricDefinitionIdRestEndpoint,
  listPulseMetricSubscriptionsForCurrentUserRestEndpoint,
  listPulseMetricsFromMetricIdsRestEndpoint,
]);
export const pulseApis = [...pulseApi] as const satisfies ZodiosEndpointDefinitions;
