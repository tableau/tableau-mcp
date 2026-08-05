import { z } from 'zod';

import { pulseBundleRequestSchema } from '../../../../sdks/tableau/types/pulse.js';

type InsightFilter = { field: string; value: string };

type BuildInsightBundleRequestArgs = {
  datasourceLuid: string;
  datasourceName: string;
  measure: string;
  timeField: string;
  allowedDimensions?: string[];
  filters?: InsightFilter[];
};

export function buildInsightBundleRequest({
  datasourceLuid,
  datasourceName,
  measure,
  timeField,
  allowedDimensions = [],
  filters = [],
}: BuildInsightBundleRequestArgs): z.infer<typeof pulseBundleRequestSchema> {
  // Categorical equality filters scope the metric instance to specific dimension
  // members (drill-down); shape matches pulseFilterSchema. Confirmed against the
  // live Pulse API: the operator must be the enum 'OPERATOR_EQUAL' (not '='), and
  // each categorical value must carry ONLY string_value — sending
  // bool_value/null_value alongside triggers HTTP 400.
  const pulseFilters = filters.map((f) => ({
    field: f.field,
    operator: 'OPERATOR_EQUAL',
    categorical_values: [{ string_value: f.value }],
  }));

  return {
    bundle_request: {
      version: 1,
      options: {
        output_format: 'OUTPUT_FORMAT_HTML',
        time_zone: 'UTC',
        language: 'LANGUAGE_EN_US',
        locale: 'LOCALE_EN_US',
      },
      input: {
        metadata: {
          name: `${datasourceName} - ${measure}`,
        },
        metric: {
          definition: {
            datasource: { id: datasourceLuid },
            basic_specification: {
              measure: {
                field: measure,
                // Known limitation (draft): aggregation is hardcoded to SUM.
                // Average/count-style measures will produce misleading cards
                // until the aggregation is derived from metadata.
                aggregation: 'AGGREGATION_SUM',
              },
              time_dimension: {
                field: timeField,
              },
              filters: [],
            },
            is_running_total: false,
          },
          metric_specification: {
            // Member filters scope the metric *instance* (drill-down), so they
            // belong here rather than in the definition's basic_specification.
            filters: pulseFilters,
            // Current month-to-date vs the prior period (period-over-period change).
            // The card renders this comparison directly so the chart matches the
            // insight's wording ("... month to date ... compared to the prior period").
            measurement_period: {
              granularity: 'GRANULARITY_BY_MONTH',
              range: 'RANGE_CURRENT_PARTIAL',
            },
            comparison: {
              comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD',
            },
          },
          extension_options: {
            allowed_dimensions: allowedDimensions,
            allowed_granularities: [],
            offset_from_today: 0,
          },
          representation_options: {
            type: 'NUMBER_FORMAT_TYPE_NUMBER',
            sentiment_type: 'SENTIMENT_TYPE_UNSPECIFIED',
            number_units: {
              singular_noun: 'value',
              plural_noun: 'values',
            },
            row_level_id_field: {
              identifier_col: '',
            },
            row_level_entity_names: {
              entity_name_singular: '',
            },
            row_level_name_field: {
              name_col: '',
            },
            currency_code: 'CURRENCY_CODE_UNSPECIFIED',
          },
          insights_options: {
            show_insights: true,
            settings: [],
          },
        },
      },
    },
  };
}
