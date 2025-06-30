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
