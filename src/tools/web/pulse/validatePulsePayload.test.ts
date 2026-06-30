import { validateBundleRequest, validateBriefRequest } from './validatePulsePayload.js';

describe('validateBundleRequest', () => {
  function makeValidBundleRequest() {
    return {
      bundle_request: {
        version: 1,
        options: {
          output_format: 'OUTPUT_FORMAT_HTML' as const,
          time_zone: 'UTC',
          language: 'LANGUAGE_EN_US' as const,
          locale: 'LOCALE_EN_US' as const,
        },
        input: {
          metadata: {
            name: 'Test Metric',
            metric_id: 'metric-1',
            definition_id: 'def-1',
          },
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
              filters: [],
              measurement_period: {
                granularity: 'GRANULARITY_BY_MONTH',
                range: 'RANGE_LAST_COMPLETE',
              },
              comparison: { comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD' },
            },
            extension_options: {
              allowed_dimensions: ['Region'],
              allowed_granularities: ['GRANULARITY_BY_MONTH'],
              offset_from_today: 0,
            },
            representation_options: {
              type: 'NUMBER_FORMAT_TYPE_NUMBER',
              number_units: { singular_noun: 'unit', plural_noun: 'units' },
              sentiment_type: 'SENTIMENT_TYPE_UNSPECIFIED',
              row_level_id_field: { identifier_col: '' },
              row_level_entity_names: {},
              row_level_name_field: { name_col: '' },
              currency_code: 'CURRENCY_CODE_UNSPECIFIED',
            },
            insights_options: { show_insights: true, settings: [] },
          },
        },
      },
    };
  }

  it('returns null for a valid request', () => {
    expect(validateBundleRequest(makeValidBundleRequest())).toBeNull();
  });

  it('catches wrong version', () => {
    const req = makeValidBundleRequest();
    req.bundle_request.version = 2;
    const result = validateBundleRequest(req);
    expect(result).toContain('version must be 1');
  });

  it('catches empty measure field', () => {
    const req = makeValidBundleRequest();
    req.bundle_request.input.metric.definition.basic_specification.measure.field = '';
    const result = validateBundleRequest(req);
    expect(result).toContain('measure.field is empty');
  });

  it('catches AGGREGATION_UNSPECIFIED', () => {
    const req = makeValidBundleRequest();
    req.bundle_request.input.metric.definition.basic_specification.measure.aggregation =
      'AGGREGATION_UNSPECIFIED';
    const result = validateBundleRequest(req);
    expect(result).toContain('measure.aggregation must be set');
  });

  it('catches GRANULARITY_UNSPECIFIED', () => {
    const req = makeValidBundleRequest();
    req.bundle_request.input.metric.metric_specification.measurement_period.granularity =
      'GRANULARITY_UNSPECIFIED';
    const result = validateBundleRequest(req);
    expect(result).toContain('granularity must be set');
  });

  it('catches RANGE_UNSPECIFIED', () => {
    const req = makeValidBundleRequest();
    req.bundle_request.input.metric.metric_specification.measurement_period.range =
      'RANGE_UNSPECIFIED';
    const result = validateBundleRequest(req);
    expect(result).toContain('range must be set');
  });

  it('catches TIME_COMPARISON_UNSPECIFIED', () => {
    const req = makeValidBundleRequest();
    req.bundle_request.input.metric.metric_specification.comparison.comparison =
      'TIME_COMPARISON_UNSPECIFIED';
    const result = validateBundleRequest(req);
    expect(result).toContain('comparison.comparison must be set');
  });

  it('catches empty datasource id', () => {
    const req = makeValidBundleRequest();
    req.bundle_request.input.metric.definition.datasource.id = '';
    const result = validateBundleRequest(req);
    expect(result).toContain('datasource.id is empty');
  });

  it('catches missing time_dimension when range and comparison are set', () => {
    const req = makeValidBundleRequest();
    req.bundle_request.input.metric.definition.basic_specification.time_dimension.field = '';
    const result = validateBundleRequest(req);
    expect(result).toContain('time_dimension.field is required');
  });

  it('accumulates multiple errors', () => {
    const req = makeValidBundleRequest();
    req.bundle_request.version = 2;
    req.bundle_request.input.metric.definition.basic_specification.measure.field = '';
    req.bundle_request.input.metric.metric_specification.measurement_period.granularity =
      'GRANULARITY_UNSPECIFIED';
    const result = validateBundleRequest(req);
    expect(result).toContain('1.');
    expect(result).toContain('2.');
    expect(result).toContain('3.');
  });
});

describe('validateBriefRequest', () => {
  function makeValidBriefRequest() {
    return {
      language: 'LANGUAGE_EN_US' as const,
      locale: 'LOCALE_EN_US' as const,
      messages: [
        {
          action_type: 'ACTION_TYPE_ANSWER' as const,
          content: 'Why did sales increase?',
          role: 'ROLE_USER' as const,
          metric_group_context: [
            {
              metadata: { name: 'Sales', metric_id: 'm-1', definition_id: 'd-1' },
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
                  filters: [],
                  measurement_period: {
                    granularity: 'GRANULARITY_BY_MONTH',
                    range: 'RANGE_LAST_COMPLETE',
                  },
                  comparison: { comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD' },
                },
                extension_options: {
                  allowed_dimensions: ['Region'],
                  allowed_granularities: ['GRANULARITY_BY_MONTH'],
                  offset_from_today: 0,
                },
                representation_options: {
                  type: 'NUMBER_FORMAT_TYPE_NUMBER',
                  number_units: { singular_noun: '', plural_noun: '' },
                  sentiment_type: 'SENTIMENT_TYPE_UNSPECIFIED',
                  row_level_id_field: { identifier_col: '' },
                  row_level_entity_names: {},
                  row_level_name_field: { name_col: '' },
                  currency_code: 'CURRENCY_CODE_UNSPECIFIED',
                },
                insights_options: { show_insights: true, settings: [] },
                candidates: [],
              },
            },
          ],
          metric_group_context_resolved: true,
        },
      ],
    };
  }

  it('returns null for a valid request', () => {
    expect(validateBriefRequest(makeValidBriefRequest())).toBeNull();
  });

  it('catches empty messages array', () => {
    const req = makeValidBriefRequest();
    req.messages = [];
    const result = validateBriefRequest(req);
    expect(result).toContain('messages array is empty');
  });

  it('catches empty content', () => {
    const req = makeValidBriefRequest();
    req.messages[0].content = '';
    const result = validateBriefRequest(req);
    expect(result).toContain('content is empty');
  });

  it('catches empty metric_group_context', () => {
    const req = makeValidBriefRequest();
    req.messages[0].metric_group_context = [];
    const result = validateBriefRequest(req);
    expect(result).toContain('metric_group_context is empty');
  });

  it('catches empty datasource id in metric context', () => {
    const req = makeValidBriefRequest();
    req.messages[0].metric_group_context[0].metric.definition.datasource.id = '';
    const result = validateBriefRequest(req);
    expect(result).toContain('datasource.id is empty');
  });

  it('catches GRANULARITY_UNSPECIFIED in metric context', () => {
    const req = makeValidBriefRequest();
    req.messages[0].metric_group_context[0].metric.metric_specification.measurement_period.granularity =
      'GRANULARITY_UNSPECIFIED';
    const result = validateBriefRequest(req);
    expect(result).toContain('granularity must be set');
  });

  it('catches empty extension_options dimensions and granularities', () => {
    const req = makeValidBriefRequest();
    req.messages[0].metric_group_context[0].metric.extension_options.allowed_dimensions = [];
    req.messages[0].metric_group_context[0].metric.extension_options.allowed_granularities = [];
    const result = validateBriefRequest(req);
    expect(result).toContain('extension_options has empty allowed_dimensions and allowed_granularities');
  });
});
