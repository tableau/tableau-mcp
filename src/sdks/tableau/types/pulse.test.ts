import {
  metricGroupContextSchema,
  pulseBundleRequestSchema,
  PulseMetric,
  PulseMetricDefinition,
  pulseMetricDefinitionSchema,
  pulseMetricDefinitionViewEnum,
  pulseMetricSchema,
  pulseMetricSubscriptionSchema,
} from './pulse.js';

describe('PulseMetricDefinition schema', () => {
  it('accepts a valid PulseMetricDefinition', () => {
    const data = createValidPulseMetricDefinition();
    expect(() => pulseMetricDefinitionSchema.parse(data)).not.toThrow();
  });

  it('rejects a PulseMetricDefinition with missing metadata', () => {
    // metadata is required
    const data = createValidPulseMetricDefinition({ metadata: undefined });
    expect(() => pulseMetricDefinitionSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetricDefinition with invalid metrics', () => {
    const data = createValidPulseMetricDefinition({
      // @ts-expect-error - is_default should be boolean
      metrics: [createValidPulseMetric({ is_default: 'yes' })],
      total_metrics: 1,
    });
    expect(() => pulseMetricDefinitionSchema.parse(data)).toThrow();
  });
});

describe('PulseMetric schema', () => {
  it('accepts a valid PulseMetric', () => {
    const data = createValidPulseMetric();
    expect(() => pulseMetricSchema.parse(data)).not.toThrow();
  });

  it('rejects a PulseMetric with missing id', () => {
    // id is required
    const data = createValidPulseMetric({ id: undefined });
    expect(() => pulseMetricSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetric with non-boolean is_default', () => {
    // @ts-expect-error - is_default should be boolean
    const data = createValidPulseMetric({ is_default: 'yes' });
    expect(() => pulseMetricSchema.parse(data)).toThrow();
  });
});

describe('pulseMetricDefinitionViewEnum', () => {
  it('contains all expected views', () => {
    expect(pulseMetricDefinitionViewEnum).toEqual([
      'DEFINITION_VIEW_BASIC',
      'DEFINITION_VIEW_FULL',
      'DEFINITION_VIEW_DEFAULT',
    ]);
  });
});

describe('PulseMetricSubscription schema', () => {
  it('accepts a valid PulseMetricSubscription', () => {
    const data = {
      id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BD',
      metric_id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
    };
    expect(() => pulseMetricSubscriptionSchema.parse(data)).not.toThrow();
  });

  it('rejects a PulseMetricSubscription with missing id', () => {
    // id is required
    const data = {
      metric_id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
    };
    expect(() => pulseMetricSubscriptionSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetricSubscription with missing metric_id', () => {
    // metric_id is required
    const data = {
      id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BD',
    };
    expect(() => pulseMetricSubscriptionSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetricSubscription with non-string id', () => {
    // id should be string
    const data = {
      id: 1234,
      metric_id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
    };
    expect(() => pulseMetricSubscriptionSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetricSubscription with non-string metric_id', () => {
    // metric_id should be string
    const data = {
      id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BD',
      metric_id: 5678,
    };
    expect(() => pulseMetricSubscriptionSchema.parse(data)).toThrow();
  });
});

describe('pulseBundleRequestSchema optionality', () => {
  const minimalBundleRequest = {
    bundle_request: {
      version: 1,
      options: {
        output_format: 'OUTPUT_FORMAT_HTML' as const,
        time_zone: 'UTC',
        language: 'LANGUAGE_EN_US' as const,
        locale: 'LOCALE_EN_US' as const,
      },
      input: {
        metadata: {},
        metric: {
          definition: {
            datasource: { id: 'ds-1' },
            basic_specification: {
              measure: { field: 'Sales', aggregation: 'AGGREGATION_SUM' },
              time_dimension: { field: 'Order Date' },
              filters: [],
            },
            is_running_total: false,
          },
          metric_specification: {
            measurement_period: {
              granularity: 'GRANULARITY_BY_MONTH',
              range: 'RANGE_LAST_COMPLETE',
            },
            comparison: { comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD' },
          },
        },
      },
    },
  };

  it('accepts a bundle request without optional fields', () => {
    const parsed = pulseBundleRequestSchema.parse(minimalBundleRequest);
    const metric = parsed.bundle_request.input.metric;
    expect(metric.extension_options).toBeUndefined();
    expect(metric.representation_options).toBeUndefined();
    expect(metric.insights_options).toBeUndefined();
    expect(metric.metric_specification.filters).toBeUndefined();
  });

  it('accepts a bundle request with partial representation_options', () => {
    const req = {
      ...minimalBundleRequest,
      bundle_request: {
        ...minimalBundleRequest.bundle_request,
        input: {
          ...minimalBundleRequest.bundle_request.input,
          metric: {
            ...minimalBundleRequest.bundle_request.input.metric,
            representation_options: {
              type: 'NUMBER_FORMAT_TYPE_NUMBER',
            },
          },
        },
      },
    };
    expect(() => pulseBundleRequestSchema.parse(req)).not.toThrow();
  });
});

describe('metricGroupContextSchema optionality', () => {
  const minimalContext = [
    {
      metadata: { name: 'Sales' },
      metric: {
        definition: {
          datasource: { id: 'ds-1' },
          basic_specification: {
            measure: { field: 'Sales', aggregation: 'AGGREGATION_SUM' },
            time_dimension: { field: 'Date' },
            filters: [],
          },
          is_running_total: false,
        },
        metric_specification: {
          measurement_period: {
            granularity: 'GRANULARITY_BY_MONTH',
            range: 'RANGE_LAST_COMPLETE',
          },
          comparison: { comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD' },
        },
      },
    },
  ];

  it('accepts metric_group_context without optional fields', () => {
    const parsed = metricGroupContextSchema.parse(minimalContext);
    const ctx = parsed[0];
    expect(ctx.metric.extension_options).toBeUndefined();
    expect(ctx.metric.representation_options).toBeUndefined();
    expect(ctx.metric.insights_options).toBeUndefined();
    expect(ctx.metric.candidates).toBeUndefined();
    expect(ctx.metadata.metric_id).toBeUndefined();
    expect(ctx.metadata.definition_id).toBeUndefined();
  });
});

export function createValidPulseMetric(overrides: Partial<PulseMetric> = {}): PulseMetric {
  return {
    id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
    specification: {
      filters: [
        {
          field: 'region',
          operator: '=',
          categorical_values: [{ string_value: 'West', bool_value: false, null_value: '' }],
        },
      ],
      measurement_period: { granularity: 'day', range: 'last_30_days' },
      comparison: { comparison: 'previous_period' },
    },
    definition_id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    datasource_luid: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11',
    is_default: true,
    schema_version: '1.0',
    metric_version: 1,
    goals: { target: { value: 100 } },
    is_followed: false,
    ...overrides,
  };
}

export function createValidPulseMetricDefinition(
  overrides: Partial<PulseMetricDefinition> = {},
): PulseMetricDefinition {
  return {
    metadata: {
      name: 'Test Metric',
      description: 'A test metric',
      id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
      schema_version: '1.0',
      metric_version: 1,
      definition_version: 1,
      last_updated_user: { id: 'USER-1234' },
    },
    specification: {
      datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11' },
      basic_specification: {
        measure: { field: 'sales', aggregation: 'SUM' },
        time_dimension: { field: 'order_date' },
        filters: [
          {
            field: 'region',
            operator: '=',
            categorical_values: [{ string_value: 'West', bool_value: false, null_value: '' }],
          },
        ],
      },
      viz_state_specification: { viz_state_string: 'state' },
      is_running_total: false,
    },
    extension_options: {
      allowed_dimensions: ['region'],
      allowed_granularities: ['day'],
      offset_from_today: 0,
    },
    metrics: [
      createValidPulseMetric(),
      createValidPulseMetric({
        id: 'CF32DDCC-362B-4869-9487-37DA4D152553',
        is_default: false,
        is_followed: true,
      }),
    ],
    total_metrics: 2,
    representation_options: {
      type: 'number',
      number_units: { singular_noun: 'unit', plural_noun: 'units' },
      sentiment_type: 'neutral',
      row_level_id_field: { identifier_col: 'id' },
      row_level_entity_names: { entity_name_singular: 'entity', entity_name_plural: 'entities' },
      row_level_name_field: { name_col: 'name' },
      currency_code: 'USD',
    },
    insights_options: {
      settings: [{ type: 'trend', disabled: false }],
    },
    comparisons: {
      comparisons: [{ compare_config: { comparison: 'previous_period' }, index: 0 }],
    },
    datasource_goals: [
      {
        basic_specification: {
          measure: { field: 'sales', aggregation: 'SUM' },
          time_dimension: { field: 'order_date' },
          filters: [],
        },
        viz_state_specification: { viz_state_string: 'goal_state' },
        minimum_granularity: 'day',
        benchmark_sentiment_type: 'BENCHMARK_SENTIMENT_TYPE_ABOVE_THRESHOLD_IS_FAVORABLE',
        name: 'Test Goal',
      },
    ],
    ...overrides,
  };
}
