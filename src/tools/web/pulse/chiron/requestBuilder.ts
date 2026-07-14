import { PulseBundleRequest } from '../../../../sdks/tableau/apis/pulseApi.js';

type BuildChironBundleRequestArgs = {
  datasourceLuid: string;
  datasourceName: string;
  measure: string;
  timeField: string;
  allowedDimensions?: string[];
};

export function buildChironBundleRequest({
  datasourceLuid,
  datasourceName,
  measure,
  timeField,
  allowedDimensions = [],
}: BuildChironBundleRequestArgs): PulseBundleRequest {
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
            filters: [],
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
              identifier_label: '',
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
