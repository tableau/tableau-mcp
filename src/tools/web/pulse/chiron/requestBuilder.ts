import z from 'zod';

import { pulseInsightBundleTypeEnum } from '../../../../sdks/tableau/types/pulse.js';

const primitiveValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const chironStudioFieldSchema = z.object({
  name: z.string().min(1),
  role: z.enum(['measure', 'time', 'dimension']),
  dataType: z.enum(['number', 'string', 'boolean', 'date', 'datetime']),
  supportedAggregations: z.array(z.string()).optional(),
  allowedFilterValues: z.array(primitiveValueSchema).optional(),
});

export const chironFilterSchema = z.object({
  field: z.string().min(1),
  operator: z.string().default('OPERATOR_IN'),
  values: z.array(primitiveValueSchema).min(1),
});

export const chironInsightModeEnum = [
  'trend',
  'top_contributors',
  'summary',
  'snapshot',
  'before_after',
  'no_data_check',
] as const;

export const chironInsightRequestSchema = z.object({
  datasource: z.object({
    id: z.string().min(1),
    isPublished: z.boolean(),
  }),
  schema: z.object({
    fields: z.array(chironStudioFieldSchema).min(1),
  }),
  context: z.object({
    measureField: z.string().min(1),
    timeField: z.string().min(1),
    dimensionFields: z.array(z.string().min(1)).default([]),
    filters: z.array(chironFilterSchema).default([]),
  }),
  insight: z.object({
    mode: z.enum(chironInsightModeEnum),
    output: z.enum(['brief', 'bundle']).default('brief'),
    bundleType: z.enum(pulseInsightBundleTypeEnum).optional(),
    question: z.string().optional(),
  }),
  options: z
    .object({
      aggregation: z.string().default('AGGREGATION_SUM'),
      granularity: z.string().default('GRANULARITY_BY_MONTH'),
      range: z.string().default('RANGE_CURRENT_PARTIAL'),
      comparison: z.string().default('TIME_COMPARISON_PREVIOUS_PERIOD'),
      language: z.string().default('LANGUAGE_EN_US'),
      locale: z.string().default('LOCALE_EN_US'),
      timeZone: z.string().default('UTC'),
      now: z.string().optional(),
      sentimentType: z.string().default('SENTIMENT_TYPE_NONE'),
      numberFormatType: z.string().default('NUMBER_FORMAT_TYPE_NUMBER'),
      currencyCode: z.string().optional(),
      goalTarget: z.number().optional(),
    })
    .default({}),
});

export type ChironInsightRequest = z.infer<typeof chironInsightRequestSchema>;

export type ChironBuiltRequests = {
  briefRequest: {
    language: string;
    locale: string;
    messages: Array<{
      action_type: 'ACTION_TYPE_ANSWER' | 'ACTION_TYPE_SUMMARIZE' | 'ACTION_TYPE_ADVISE';
      content: string;
      role: 'ROLE_USER';
      metric_group_context: Array<{
        metadata: {
          name: string;
        };
        metric: {
          definition: {
            datasource: { id: string };
            basic_specification: {
              measure: { field: string; aggregation: string };
              time_dimension: { field: string };
              filters: Array<{
                field: string;
                operator: string;
                categorical_values: Array<{
                  string_value?: string;
                  bool_value?: boolean;
                }>;
              }>;
            };
            is_running_total: boolean;
          };
          metric_specification: {
            filters: Array<{
              field: string;
              operator: string;
              categorical_values: Array<{
                string_value?: string;
                bool_value?: boolean;
              }>;
            }>;
            measurement_period: {
              granularity: string;
              range: string;
            };
            comparison: { comparison: string };
          };
          extension_options: {
            allowed_dimensions: string[];
            allowed_granularities: string[];
            offset_from_today: number;
          };
          representation_options: {
            type: string;
            sentiment_type: string;
            currency_code?: string;
          };
          insights_options: {
            show_insights: true;
            settings: Array<{ type: string; disabled: boolean }>;
          };
          goals?: {
            datasource_goals: [];
            metric_goals: {
              target: { value: number };
            };
          };
          candidates: [];
        };
      }>;
      metric_group_context_resolved: true;
    }>;
    now?: string;
    time_zone: string;
  };
  bundleRequest: {
    bundle_request: {
      version: 1;
      options: {
        output_format: 'OUTPUT_FORMAT_HTML';
        time_zone: string;
        language: string;
        locale: string;
      };
      input: {
        metadata: {
          name: string;
        };
        metric: {
          definition: {
            datasource: { id: string };
            basic_specification: {
              measure: { field: string; aggregation: string };
              time_dimension: { field: string };
              filters: Array<{
                field: string;
                operator: string;
                categorical_values: Array<{
                  string_value?: string;
                  bool_value?: boolean;
                }>;
              }>;
            };
            is_running_total: false;
          };
          metric_specification: {
            filters: Array<{
              field: string;
              operator: string;
              categorical_values: Array<{
                string_value?: string;
                bool_value?: boolean;
              }>;
            }>;
            measurement_period: {
              granularity: string;
              range: string;
            };
            comparison: { comparison: string };
          };
          extension_options: {
            allowed_dimensions: string[];
            allowed_granularities: string[];
            offset_from_today: number;
          };
          representation_options: {
            type: string;
            sentiment_type: string;
            currency_code?: string;
          };
          insights_options: {
            show_insights: true;
            settings: Array<{ type: string; disabled: boolean }>;
          };
          goals?: {
            target: { value: number };
          };
        };
      };
    };
  };
};

const MAX_ALLOWED_DIMENSIONS = 8;

export function buildChironRequests(rawInput: ChironInsightRequest): ChironBuiltRequests {
  const input = chironInsightRequestSchema.parse(rawInput);
  validateInput(input);

  const measureField = getFieldByName(input.schema.fields, input.context.measureField);
  const timeField = getFieldByName(input.schema.fields, input.context.timeField);
  const dimensionFields = dedupeAndSort(input.context.dimensionFields);
  const pulseFilters = buildPulseFilters(input.context.filters);

  if (dimensionFields.length > MAX_ALLOWED_DIMENSIONS) {
    throw new Error(
      `Too many allowed dimensions. Received ${dimensionFields.length}, max is ${MAX_ALLOWED_DIMENSIONS}.`,
    );
  }

  if (
    measureField.supportedAggregations &&
    !measureField.supportedAggregations.includes(input.options.aggregation)
  ) {
    throw new Error(
      `Aggregation ${input.options.aggregation} is not valid for measure ${measureField.name}.`,
    );
  }

  // Chiron generates insights from live Studio datasource context, so there is no
  // stored Pulse metric or definition — hence no metric_id / definition_id to send.
  // The Insights Service brief/bundle endpoints key off the inline datasource + spec
  // and treat these IDs as log-only, so we omit them rather than fabricate values
  // that would pollute the service's metric_luids / definition_luids telemetry.
  const metricName = `${measureField.name} (${input.insight.mode})`;
  // The Pulse Insights API rejects any fabricated insights_options.settings[].type
  // (only its own internal enum is valid). Send an empty settings list and let the
  // Insight Service decide which insights to run; the requested mode still drives the
  // brief action_type / question and the bundle type instead.
  const settings: Array<{ type: string; disabled: boolean }> = [];

  const sharedMetric = {
    definition: {
      datasource: { id: input.datasource.id },
      basic_specification: {
        measure: { field: measureField.name, aggregation: input.options.aggregation },
        time_dimension: { field: timeField.name },
        filters: pulseFilters,
      },
      is_running_total: false,
    },
    metric_specification: {
      filters: pulseFilters,
      measurement_period: {
        granularity: input.options.granularity,
        range: input.options.range,
      },
      comparison: {
        comparison: input.options.comparison,
      },
    },
    extension_options: {
      allowed_dimensions: dimensionFields,
      allowed_granularities: [input.options.granularity],
      offset_from_today: 0,
    },
    representation_options: {
      type: input.options.numberFormatType,
      sentiment_type: input.options.sentimentType,
      ...(input.options.currencyCode ? { currency_code: input.options.currencyCode } : {}),
    },
    insights_options: {
      show_insights: true as const,
      settings,
    },
  };

  const metricWithGoals = input.options.goalTarget
    ? {
        ...sharedMetric,
        goals: {
          target: { value: input.options.goalTarget },
        },
      }
    : sharedMetric;

  const bundleRequest = {
    bundle_request: {
      version: 1 as const,
      options: {
        output_format: 'OUTPUT_FORMAT_HTML' as const,
        time_zone: input.options.timeZone,
        language: input.options.language,
        locale: input.options.locale,
      },
      input: {
        metadata: {
          name: metricName,
        },
        metric: metricWithGoals,
      },
    },
  };

  const briefRequest = {
    language: input.options.language,
    locale: input.options.locale,
    messages: [
      {
        action_type: getActionType(input.insight.mode),
        content:
          input.insight.question ?? getDefaultQuestion(input.insight.mode, measureField.name),
        role: 'ROLE_USER' as const,
        metric_group_context: [
          {
            metadata: {
              name: metricName,
            },
            metric: {
              ...metricWithGoals,
              ...(input.options.goalTarget
                ? {
                    goals: {
                      datasource_goals: [],
                      metric_goals: {
                        target: { value: input.options.goalTarget },
                      },
                    },
                  }
                : {}),
              candidates: [],
            },
          },
        ],
        metric_group_context_resolved: true as const,
      },
    ],
    ...(input.options.now ? { now: input.options.now } : {}),
    time_zone: input.options.timeZone,
  };

  return {
    briefRequest,
    bundleRequest,
  };
}

function validateInput(input: ChironInsightRequest): void {
  if (!input.datasource.isPublished) {
    throw new Error('Local or unpublished datasources are not allowed.');
  }

  const measureField = getFieldByName(input.schema.fields, input.context.measureField);
  if (measureField.role !== 'measure') {
    throw new Error(`Field ${measureField.name} must be a measure field.`);
  }

  const timeField = getFieldByName(input.schema.fields, input.context.timeField);
  if (timeField.role !== 'time') {
    throw new Error(`Field ${timeField.name} must be a time field.`);
  }

  for (const dimensionFieldName of input.context.dimensionFields) {
    const dimensionField = getFieldByName(input.schema.fields, dimensionFieldName);
    if (dimensionField.role !== 'dimension') {
      throw new Error(`Field ${dimensionField.name} must be a dimension field.`);
    }
  }

  for (const filter of input.context.filters) {
    const filterField = getFieldByName(input.schema.fields, filter.field);
    if (filterField.allowedFilterValues) {
      for (const value of filter.values) {
        const isAllowed = filterField.allowedFilterValues.some((allowed) => allowed === value);
        if (!isAllowed) {
          throw new Error(
            `Filter value ${String(value)} is not allowed for field ${filter.field}.`,
          );
        }
      }
    }
  }
}

function getFieldByName(
  fields: Array<z.infer<typeof chironStudioFieldSchema>>,
  fieldName: string,
): z.infer<typeof chironStudioFieldSchema> {
  const field = fields.find((candidate) => candidate.name === fieldName);
  if (!field) {
    throw new Error(`Field ${fieldName} does not exist in the datasource schema.`);
  }

  return field;
}

function buildPulseFilters(filters: Array<z.infer<typeof chironFilterSchema>>): Array<{
  field: string;
  operator: string;
  categorical_values: Array<{ string_value?: string; bool_value?: boolean }>;
}> {
  const normalized = filters
    .map((filter) => ({
      field: filter.field,
      operator: filter.operator,
      values: [...filter.values].sort((a, b) => String(a).localeCompare(String(b))),
    }))
    .sort((a, b) => a.field.localeCompare(b.field));

  return normalized.map((filter) => ({
    field: filter.field,
    operator: filter.operator,
    categorical_values: filter.values.map((value) =>
      typeof value === 'boolean' ? { bool_value: value } : { string_value: String(value) },
    ),
  }));
}

function getActionType(
  mode: (typeof chironInsightModeEnum)[number],
): 'ACTION_TYPE_ANSWER' | 'ACTION_TYPE_SUMMARIZE' | 'ACTION_TYPE_ADVISE' {
  if (mode === 'summary' || mode === 'snapshot') {
    return 'ACTION_TYPE_SUMMARIZE';
  }

  if (mode === 'top_contributors' || mode === 'before_after') {
    return 'ACTION_TYPE_ANSWER';
  }

  return 'ACTION_TYPE_ADVISE';
}

function getDefaultQuestion(
  mode: (typeof chironInsightModeEnum)[number],
  measureField: string,
): string {
  switch (mode) {
    case 'trend':
      return `Summarize the trend for ${measureField}.`;
    case 'top_contributors':
      return `What are the top contributors for ${measureField}?`;
    case 'summary':
      return `Summarize ${measureField} performance.`;
    case 'snapshot':
      return `Give a snapshot of ${measureField}.`;
    case 'before_after':
      return `What changed before and after for ${measureField}?`;
    case 'no_data_check':
      return `Check for missing data signals in ${measureField}.`;
  }
}

function dedupeAndSort(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
