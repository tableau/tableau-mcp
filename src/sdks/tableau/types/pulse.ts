import { z } from 'zod';

export const definitionRequestSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    specification: z
      .object({
        datasource: z.object({ id: z.string() }),
        basic_specification: z.object({
          measure: z.object({ field: z.string(), aggregation: z.string() }),
          time_dimension: z.object({ field: z.string() }),
          filters: z.array(
            z.object({
              field: z.string(),
              operator: z.string(),
              categorical_values: z.array(
                z
                  .object({
                    string_value: z.string(),
                    bool_value: z.boolean(),
                    null_value: z.string(),
                  })
                  .partial(),
              ),
            }),
          ),
        }),
        viz_state_specification: z.object({ viz_state_string: z.string() }),
        is_running_total: z.boolean(),
      })
      .partial(),
    extension_options: z
      .object({
        allowed_dimensions: z.array(z.string()),
        allowed_granularities: z.array(z.string()),
        offset_from_today: z.number(),
      })
      .partial(),
    representation_options: z
      .object({
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
        row_level_name_field: z.object({ name_col: z.string() }).partial(),
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
      })
      .partial(),
    insights_options: z
      .object({
        show_insights: z.boolean(),
        settings: z.array(
          z.object({ type: z.string(), $ref: z.string(), disabled: z.boolean() }).partial(),
        ),
        nestedInsightSetting: z.object({
          type: z.string(),
          $ref: z.string(),
          disabled: z.boolean(),
        }),
      })
      .partial(),
    comparisons: z.object({
      comparisons: z.array(
        z.object({
          compare_config: z.object({ comparison: z.string() }),
          index: z.number(),
        }),
      ),
    }),
    datasource_goals: z.array(
      z.object({
        basic_specification: z.object({
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
        }),
        viz_state_specification: z.object({ viz_state_string: z.string() }),
        minimum_granularity: z.string(),
      }),
    ),
  })
  .partial();

export const definitionSchema = z.object({
  metadata: z.object({
    name: z.string(),
    description: z.string(),
    id: z.string(),
    schema_version: z.string(),
    metric_version: z.number(),
    definition_version: z.number(),
    last_updated_user: z.object({ id: z.string() }),
    nestedUser: z.object({ id: z.string() }),
  }),
  specification: z.object({
    datasource: z.object({ id: z.string() }),
    basic_specification: z.object({
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
    }),
    viz_state_specification: z.object({ viz_state_string: z.string() }),
    is_running_total: z.boolean(),
  }),
  extension_options: z.object({
    allowed_dimensions: z.array(z.string()),
    allowed_granularities: z.array(z.string()),
    offset_from_today: z.number(),
  }),
  metrics: z.array(
    z.object({
      id: z.string(),
      specification: z.object({
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
        measurement_period: z.object({
          granularity: z.string(),
          range: z.string(),
        }),
        comparison: z.object({ comparison: z.string() }),
      }),
      definition_id: z.string(),
      is_default: z.boolean(),
      schema_version: z.string(),
      metric_version: z.number(),
      goals: z.object({ target: z.object({ value: z.number() }) }),
      is_followed: z.boolean(),
    }),
  ),
  total_metrics: z.number(),
  representation_options: z.object({
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
  }),
  insights_options: z.object({
    show_insights: z.boolean(),
    settings: z.array(z.object({ type: z.string(), $ref: z.string(), disabled: z.boolean() })),
    nestedInsightSetting: z.object({
      type: z.string(),
      $ref: z.string(),
      disabled: z.boolean(),
    }),
  }),
  comparisons: z.object({
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
  }),
  datasource_goals: z.array(
    z.object({
      basic_specification: z.object({
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
      }),
      viz_state_specification: z.object({ viz_state_string: z.string() }),
      minimum_granularity: z.string(),
    }),
  ),
});

export const metricSchema = z.object({
  id: z.string(),
  specification: z.object({
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
    measurement_period: z.object({
      granularity: z.string(),
      range: z.string(),
    }),
    comparison: z.object({ comparison: z.string() }),
  }),
  definition_id: z.string(),
  is_default: z.boolean(),
  schema_version: z.string(),
  metric_version: z.number(),
  goals: z.object({ target: z.object({ value: z.number() }) }),
  is_followed: z.boolean(),
});

export const entitlementsSchema = z.array(
  z.object({
    entitlement_type: z.string(),
    enabled: z.boolean(),
  }),
);

export type DefinitionRequest = z.infer<typeof definitionRequestSchema>;
export type Definition = z.infer<typeof definitionSchema>;
export type Metric = z.infer<typeof metricSchema>;
export type Entitlements = z.infer<typeof entitlementsSchema>;
