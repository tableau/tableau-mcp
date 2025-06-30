import {
  pulseMetricDefinitionSchema,
  pulseMetricDefinitionViewEnum,
  pulseMetricSchema,
  pulseMetricSubscriptionSchema,
} from './pulse.js';

describe('PulseMetricDefinition schema', () => {
  it('accepts a valid PulseMetricDefinition', () => {
    const data = {
      metadata: { name: 'Test Metric', id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3' },
      specification: { datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11' } },
      metrics: [
        { id: 'CF32DDCC-362B-4869-9487-37DA4D152552', is_default: true, is_followed: false },
        { id: 'CF32DDCC-362B-4869-9487-37DA4D152553', is_default: false, is_followed: true },
      ],
    };
    expect(() => pulseMetricDefinitionSchema.parse(data)).not.toThrow();
  });

  it('rejects a PulseMetricDefinition with missing metadata', () => {
    const data = {
      specification: { datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A12' } },
      metrics: [],
    };
    expect(() => pulseMetricDefinitionSchema.parse(data)).toThrow();
  });

  it('rejects a PulseMetricDefinition with invalid metrics', () => {
    const data = {
      metadata: { name: 'Test Metric', id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C8' },
      specification: { datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A13' } },
      metrics: [
        {
          id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
          is_default: 'yes',
          is_followed: false,
        },
      ], // is_default should be boolean
    };
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
