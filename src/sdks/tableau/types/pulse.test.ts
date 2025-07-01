import {
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
    const data = createValidPulseMetricDefinition({ metadata: undefined });
    expect(() => pulseMetricDefinitionSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetricDefinition with invalid metrics', () => {
    const data = createValidPulseMetricDefinition({
      metrics: [
        {
          id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
          is_default: 'yes', // is_default should be boolean
          is_followed: false,
        },
      ],
      total_metrics: 1,
    });
    expect(() => pulseMetricDefinitionSchema.parse(data)).toThrow();
  });
});

describe('PulseMetric schema', () => {
  it('accepts a valid PulseMetric', () => {
    const data = {
      id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
      is_default: true,
      is_followed: false,
    };
    expect(() => pulseMetricSchema.parse(data)).not.toThrow();
  });

  it('rejects a PulseMetric with missing id', () => {
    const data = { is_default: true, is_followed: false };
    expect(() => pulseMetricSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetric with non-boolean is_default', () => {
    const data = {
      id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
      is_default: 'yes',
      is_followed: false,
    };
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
    const data = {
      metric_id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
    };
    expect(() => pulseMetricSubscriptionSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetricSubscription with missing metric_id', () => {
    const data = {
      id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BD',
    };
    expect(() => pulseMetricSubscriptionSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetricSubscription with non-string id', () => {
    const data = {
      id: 1234,
      metric_id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
    };
    expect(() => pulseMetricSubscriptionSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetricSubscription with non-string metric_id', () => {
    const data = {
      id: '2FDE35F3-602E-43D9-981A-A2A5AC1DE7BD',
      metric_id: 5678,
    };
    expect(() => pulseMetricSubscriptionSchema.parse(data)).toThrow();
  });
});

function createValidPulseMetricDefinition(overrides = {}): any {
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
      { id: 'CF32DDCC-362B-4869-9487-37DA4D152552', is_default: true, is_followed: false },
      { id: 'CF32DDCC-362B-4869-9487-37DA4D152553', is_default: false, is_followed: true },
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
      },
    ],
    ...overrides,
  };
}
