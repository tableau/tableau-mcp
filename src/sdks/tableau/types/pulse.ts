import { z } from 'zod';

const pulseMetadataSchema = z.object({
  name: z.string(),
  description: z.string(),
  id: z.string(),
  schema_version: z.string(),
  metric_version: z.coerce.number(),
  definition_version: z.coerce.number(),
  last_updated_user: z.object({ id: z.string() }).optional(),
});

const pulseDatasourceSchema = z.object({
  id: z.string(),
});

const pulseFilterSchema = z.object({
  field: z.string(),
  operator: z.string(),
  categorical_values: z.array(
    z.object({
      string_value: z.string().optional(),
      bool_value: z.boolean().optional(),
      null_value: z.string().optional(),
    }),
  ),
});

const pulseBasicSpecificationSchema = z.object({
  measure: z.object({ field: z.string(), aggregation: z.string() }),
  time_dimension: z.object({ field: z.string() }),
  filters: z.array(pulseFilterSchema),
});

const pulseSpecificationSchema = z.object({
  datasource: pulseDatasourceSchema,
  basic_specification: pulseBasicSpecificationSchema,
  viz_state_specification: z.object({ viz_state_string: z.string() }).optional(),
  is_running_total: z.boolean(),
});

export const pulseExtensionOptionsSchema = z.object({
  allowed_dimensions: z.array(z.string()),
  allowed_granularities: z.array(z.string()),
  offset_from_today: z.number(),
});

export const pulseMetricSpecificationSchema = z.object({
  filters: z.array(pulseFilterSchema),
  measurement_period: z.object({
    granularity: z.string(),
    range: z.string(),
  }),
  comparison: z.object({ comparison: z.string() }),
});

export const pulseGoalsSchema = z.object({
  target: z.object({ value: z.number() }).optional(),
});

export const pulseMetricSchema = z.object({
  id: z.string(),
  specification: pulseMetricSpecificationSchema,
  definition_id: z.string(),
  is_default: z.boolean(),
  schema_version: z.string(),
  metric_version: z.coerce.number(),
  goals: pulseGoalsSchema.optional(),
  is_followed: z.boolean(),
  datasource_luid: z.string(),
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
    entity_name_singular: z.string().optional(),
    entity_name_plural: z.string().optional(),
  }),
  row_level_name_field: z.object({ name_col: z.string() }),
  currency_code: z.string(),
});

export const insightOptionsSchema = z.object({
  settings: z.array(z.object({ type: z.string(), disabled: z.boolean() })),
});

export const comparisonSchema = z.object({
  comparisons: z.array(
    z.object({
      compare_config: z.object({ comparison: z.string() }),
      index: z.coerce.number(),
    }),
  ),
});

export const datasourceGoalsSchema = z.array(
  z.object({
    basic_specification: pulseBasicSpecificationSchema,
    viz_state_specification: z.object({ viz_state_string: z.string() }).optional(),
    minimum_granularity: z.string(),
  }),
);

export const pulseMetricDefinitionSchema = z.object({
  metadata: pulseMetadataSchema,
  specification: pulseSpecificationSchema,
  extension_options: pulseExtensionOptionsSchema,
  metrics: z.array(pulseMetricSchema),
  total_metrics: z.coerce.number(),
  representation_options: pulseRepresentationOptionsSchema,
  insights_options: insightOptionsSchema,
  comparisons: comparisonSchema,
  datasource_goals: datasourceGoalsSchema,
});

export const pulseMetricSubscriptionSchema = z.object({
  id: z.string(),
  metric_id: z.string(),
});

export const languageEnumSchema = z.enum([
  'LANGUAGE_UNSPECIFIED',
  'LANGUAGE_DE_DE',
  'LANGUAGE_EN_US',
  'LANGUAGE_EN_GB',
  'LANGUAGE_ES_ES',
  'LANGUAGE_FR_FR',
  'LANGUAGE_FR_CA',
  'LANGUAGE_GA_IE',
  'LANGUAGE_IT_IT',
  'LANGUAGE_JA_JP',
  'LANGUAGE_KO_KR',
  'LANGUAGE_NL_NL',
  'LANGUAGE_PT_BR',
  'LANGUAGE_SV_SE',
  'LANGUAGE_TH_TH',
  'LANGUAGE_ZH_CN',
  'LANGUAGE_ZH_TW',
]);
export type LanguageEnumType = z.infer<typeof languageEnumSchema>;

export const localeEnumSchema = z.enum([
  'LOCALE_UNSPECIFIED',
  'LOCALE_AR_AE',
  'LOCALE_AR_BH',
  'LOCALE_AR_DZ',
  'LOCALE_AR_EG',
  'LOCALE_AR_IQ',
  'LOCALE_AR_JO',
  'LOCALE_AR_KW',
  'LOCALE_AR_LB',
  'LOCALE_AR_LY',
  'LOCALE_AR_MA',
  'LOCALE_AR_OM',
  'LOCALE_AR_QA',
  'LOCALE_AR_SA',
  'LOCALE_AR_SD',
  'LOCALE_AR_SY',
  'LOCALE_AR_TN',
  'LOCALE_AR_YE',
  'LOCALE_BE_BY',
  'LOCALE_BG_BG',
  'LOCALE_CA_ES',
  'LOCALE_CS_CZ',
  'LOCALE_DA_DK',
  'LOCALE_DE_AT',
  'LOCALE_DE_CH',
  'LOCALE_DE_DE',
  'LOCALE_DE_LU',
  'LOCALE_EL_CY',
  'LOCALE_EL_GR',
  'LOCALE_EN_AU',
  'LOCALE_EN_CA',
  'LOCALE_EN_GB',
  'LOCALE_EN_IE',
  'LOCALE_EN_IN',
  'LOCALE_EN_MT',
  'LOCALE_EN_NZ',
  'LOCALE_EN_PH',
  'LOCALE_EN_SG',
  'LOCALE_EN_US',
  'LOCALE_EN_ZA',
  'LOCALE_ES_AR',
  'LOCALE_ES_BO',
  'LOCALE_ES_CL',
  'LOCALE_ES_CO',
  'LOCALE_ES_CR',
  'LOCALE_ES_DO',
  'LOCALE_ES_EC',
  'LOCALE_ES_ES',
  'LOCALE_ES_GT',
  'LOCALE_ES_HN',
  'LOCALE_ES_MX',
  'LOCALE_ES_NI',
  'LOCALE_ES_PA',
  'LOCALE_ES_PE',
  'LOCALE_ES_PR',
  'LOCALE_ES_PY',
  'LOCALE_ES_SV',
  'LOCALE_ES_US',
  'LOCALE_ES_UY',
  'LOCALE_ES_VE',
  'LOCALE_ET_EE',
  'LOCALE_FI_FI',
  'LOCALE_FR_BE',
  'LOCALE_FR_CA',
  'LOCALE_FR_CH',
  'LOCALE_FR_FR',
  'LOCALE_FR_LU',
  'LOCALE_GA_IE',
  'LOCALE_HE_IL',
  'LOCALE_HI_IN',
  'LOCALE_HR_HR',
  'LOCALE_HU_HU',
  'LOCALE_ID_ID',
  'LOCALE_IN_ID',
  'LOCALE_IS_IS',
  'LOCALE_IT_CH',
  'LOCALE_IT_IT',
  'LOCALE_IW_IL',
  'LOCALE_JA_JP',
  'LOCALE_KO_KR',
  'LOCALE_LT_LT',
  'LOCALE_LV_LV',
  'LOCALE_MK_MK',
  'LOCALE_MS_MY',
  'LOCALE_MT_MT',
  'LOCALE_NL_BE',
  'LOCALE_NL_NL',
  'LOCALE_NB_NO',
  'LOCALE_NO_NO',
  'LOCALE_PL_PL',
  'LOCALE_PT_BR',
  'LOCALE_PT_PT',
  'LOCALE_RO_RO',
  'LOCALE_RU_RU',
  'LOCALE_SK_SK',
  'LOCALE_SL_SI',
  'LOCALE_SQ_AL',
  'LOCALE_SR_BA',
  'LOCALE_SR_ME',
  'LOCALE_SR_RS',
  'LOCALE_SV_SE',
  'LOCALE_TH_TH',
  'LOCALE_TR_TR',
  'LOCALE_UK_UA',
  'LOCALE_VI_VN',
  'LOCALE_ZH_CN',
  'LOCALE_ZH_HK',
  'LOCALE_ZH_SG',
  'LOCALE_ZH_TW',
]);
export type LocaleEnumType = z.infer<typeof localeEnumSchema>;

export const outputFormatEnumSchema = z.enum([
  'OUTPUT_FORMAT_UNSPECIFIED',
  'OUTPUT_FORMAT_HTML',
  'OUTPUT_FORMAT_TEXT',
]);
export type OutputFormatEnumType = z.infer<typeof outputFormatEnumSchema>;

export const pulseBundleRequestSchema = z.object({
  bundle_request: z.object({
    version: z.number(),
    options: z.object({
      output_format: outputFormatEnumSchema,
      time_zone: z.string(),
      language: languageEnumSchema,
      locale: localeEnumSchema,
    }),
    input: z.object({
      metadata: z.object({
        name: z.string().nonempty(),
        metric_id: z.string().nonempty(),
        definition_id: z.string().nonempty(),
      }),
      metric: z.object({
        definition: z.object({
          datasource: z.object({
            id: z.string(),
          }),
          basic_specification: pulseBasicSpecificationSchema,
          is_running_total: z.boolean(),
        }),
        metric_specification: pulseMetricSpecificationSchema,
        extension_options: pulseExtensionOptionsSchema,
        representation_options: pulseRepresentationOptionsSchema,
        insights_options: insightOptionsSchema,
        goals: pulseGoalsSchema.optional(),
      }),
    }),
  }),
});

export const popcBanInsightGroupSchema = z.object({
  type: z.string(),
  insights: z.array(
    z.object({
      result: z.object({
        type: z.string(),
        version: z.number(),
        content: z.string().optional(),
        markup: z.string().optional(),
        viz: z.any().optional(),
        facts: z.any().optional(),
        characterization: z.string().optional(),
        question: z.string(),
        score: z.number(),
      }),
      insight_type: z.string(),
    }),
  ),
  summaries: z.array(
    z.object({
      result: z.object({
        id: z.string(),
        markup: z.string().optional(),
        viz: z.any().optional(),
        generation_id: z.string(),
        timestamp: z.string().optional(),
        last_attempted_timestamp: z.string().optional(),
      }),
    }),
  ),
});

export const pulseBundleResponseSchema = z.object({
  bundle_response: z.object({
    result: z.object({
      insight_groups: z.array(popcBanInsightGroupSchema),
      has_errors: z.boolean(),
      characterization: z.string(),
    }),
  }),
});

export type PulseBundleResponse = z.infer<typeof pulseBundleResponseSchema>;

export const pulseInsightBundleTypeEnum = ['ban', 'springboard', 'basic', 'detail'] as const;
export type PulseInsightBundleType = (typeof pulseInsightBundleTypeEnum)[number];

export const pulseMetricDefinitionViewEnum = [
  'DEFINITION_VIEW_BASIC',
  'DEFINITION_VIEW_FULL',
  'DEFINITION_VIEW_DEFAULT',
] as const;
export type PulseMetricDefinitionView = (typeof pulseMetricDefinitionViewEnum)[number];

export type PulseMetricDefinition = z.infer<typeof pulseMetricDefinitionSchema>;
export type PulseMetric = z.infer<typeof pulseMetricSchema>;
export type PulseMetricSubscription = z.infer<typeof pulseMetricSubscriptionSchema>;
