import { z } from 'zod';

const pulseMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  id: z.string(),
  schema_version: z.string(),
  metric_version: z.number(),
  definition_version: z.number(),
  last_updated_user: z.object({ id: z.string() }),
  nestedUser: z.object({ id: z.string() }),
});

const pulseDatasourceSchema = z.object({
  id: z.string(),
});

const pulseBasicSpecificationSchema = z.object({
  measure: z.object({ field: z.string(), aggregation: z.string() }),
  time_dimension: z.object({ field: z.string() }),
  filters: z.array(
    z.object({
      field: z.string(),
      operator: z.string(),
      categorical_values: z.array(
        z.object({
          string_value: z.string(),
          bool_value: z.boolean(),
          null_value: z.string(),
        }),
      ),
    }),
  ),
});

const pulseSpecificationSchema = z.object({
  datasource: pulseDatasourceSchema,
  basic_specification: pulseBasicSpecificationSchema,
  viz_state_specification: z.object({ viz_state_string: z.string() }),
  is_running_total: z.boolean(),
});

export const pulseExtensionOptionsSchema = z.object({
  allowed_dimensions: z.array(z.string()),
  allowed_granularities: z.array(z.string()),
  offset_from_today: z.number(),
});

export const pulseMetricSchema = z.object({
  id: z.string(),
  is_default: z.boolean(),
  is_followed: z.boolean(),
});

export const pulseRepresentationOptionsSchema = z.object({
  type: z.string(),
  number_units: z.object({
    singular_noun: z.string(),
    plural_noun: z.string(),
  }),
  sentiment_type: z.string(),
  row_level_id_field: z.object({ identifier_col: z.string() }),
  row_level_entity_names: z.object({
    entity_name_singular: z.string(),
    entity_name_plural: z.string(),
  }),
  row_level_name_field: z.object({ name_col: z.string() }),
  currency_code: z.string(),
  nestedNumberUnits: z.object({
    singular_noun: z.string(),
    plural_noun: z.string(),
  }),
  nestedRowLevelIDField: z.object({ identifier_col: z.string() }),
  nestedRowLevelNameField: z.object({ name_col: z.string() }),
  nestedRowLevelEntityNames: z.object({
    entity_name_singular: z.string(),
    entity_name_plural: z.string(),
  }),
});

export const insightOptionsSchema = z.object({
  show_insights: z.boolean(),
  settings: z.array(z.object({ type: z.string(), $ref: z.string(), disabled: z.boolean() })),
  nestedInsightSetting: z.object({
    type: z.string(),
    $ref: z.string(),
    disabled: z.boolean(),
  }),
});

export const comparisonSchema = z.object({
  comparisons: z.array(
    z.object({
      compare_config: z.object({ comparison: z.string() }),
      index: z.number(),
    }),
  ),
  nestedComparison: z.object({
    compare_config: z.object({ comparison: z.string() }),
    index: z.number(),
  }),
});

export const datasourceGoalsSchema = z.array(
  z.object({
    basic_specification: pulseBasicSpecificationSchema,
    viz_state_specification: z.object({ viz_state_string: z.string() }),
    minimum_granularity: z.string(),
  }),
);

export const pulseMetricDefinitionSchema = z.object({
  metadata: pulseMetadataSchema,
  specification: pulseSpecificationSchema,
  extension_options: pulseExtensionOptionsSchema,
  metrics: z.array(pulseMetricSchema),
  total_metrics: z.number(),
  representation_options: pulseRepresentationOptionsSchema,
  insights_options: insightOptionsSchema,
  comparisons: comparisonSchema,
  datasource_goals: datasourceGoalsSchema,
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
