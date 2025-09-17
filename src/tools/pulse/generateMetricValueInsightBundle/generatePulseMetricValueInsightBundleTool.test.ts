import { Ok } from 'ts-results-es';

import { Server } from '../../../server.js';
import { getGeneratePulseMetricValueInsightBundleTool } from './generatePulseMetricValueInsightBundleTool.js';

const mocks = vi.hoisted(() => ({
  mockGeneratePulseMetricValueInsightBundle: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        generatePulseMetricValueInsightBundle: mocks.mockGeneratePulseMetricValueInsightBundle,
      },
    }),
  ),
}));

describe('getGeneratePulseMetricValueInsightBundleTool', () => {
  const tool = getGeneratePulseMetricValueInsightBundleTool(new Server());

  const bundleRequest = {
    bundle_request: {
      version: 1,
      options: {
        output_format: 'OUTPUT_FORMAT_HTML',
        time_zone: 'UTC',
        language: 'LANGUAGE_EN_US',
        locale: 'LOCALE_EN_US',
      } as const,
      input: {
        metadata: {
          name: 'Pulse Metric',
          metric_id: 'CF32DDCC-362B-4869-9487-37DA4D152552',
          definition_id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
        },
        metric: {
          definition: {
            datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11' },
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
              granularity: 'GRANULARITY_BY_QUARTER',
              range: 'RANGE_LAST_COMPLETE',
            },
            comparison: {
              comparison: 'TIME_COMPARISON_PREVIOUS_PERIOD',
            },
          },
          extension_options: {
            allowed_dimensions: [],
            allowed_granularities: [],
            offset_from_today: 0,
          },
          representation_options: {
            type: 'NUMBER_FORMAT_TYPE_NUMBER',
            number_units: {
              singular_noun: 'unit',
              plural_noun: 'units',
            },
            sentiment_type: 'SENTIMENT_TYPE_UNSPECIFIED',
            row_level_id_field: {
              identifier_col: 'Order ID',
              identifier_label: '',
            },
            row_level_entity_names: {
              entity_name_singular: 'Order',
            },
            row_level_name_field: {
              name_col: 'Order Name',
            },
            currency_code: 'CURRENCY_CODE_USD',
          },
          insights_options: {
            show_insights: true,
            settings: [],
          },
          goals: {
            target: {
              value: 100,
            },
          },
        },
      },
    },
  };

  const mockBundleRequestResponse = {
    bundle_response: {
      result: {
        insight_groups: [],
        has_errors: false,
        characterization: 'CHARACTERIZATION_UNSPECIFIED',
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should call generatePulseMetricValueInsightBundle without bundleType and return Ok result', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );
    const result = await tool.callback(
      { bundleRequest },
      {
        signal: new AbortController().signal,
        requestId: 'test-request-id',
        sendNotification: vi.fn(),
        sendRequest: vi.fn(),
      },
    );
    expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledWith(
      bundleRequest,
      'ban',
    );
    expect(result.isError).toBe(false);
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockBundleRequestResponse);
  });

  it('should call generatePulseMetricValueInsightBundle with bundleType and return Ok result', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );
    const result = await tool.callback(
      { bundleRequest, bundleType: 'springboard' },
      {
        signal: new AbortController().signal,
        requestId: 'test-request-id',
        sendNotification: vi.fn(),
        sendRequest: vi.fn(),
      },
    );
    expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledWith(
      bundleRequest,
      'springboard',
    );
    expect(result.isError).toBe(false);
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockBundleRequestResponse);
  });

  it.each(['ban', 'springboard', 'basic', 'detail'] as const)(
    'should call generatePulseMetricValueInsightBundle with bundleType "%s" and return Ok result',
    async (bundleType) => {
      mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
        new Ok(mockBundleRequestResponse),
      );
      const result = await tool.callback(
        { bundleRequest, bundleType },
        {
          signal: new AbortController().signal,
          requestId: 'test-request-id',
          sendNotification: vi.fn(),
          sendRequest: vi.fn(),
        },
      );
      expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledWith(
        bundleRequest,
        bundleType,
      );
      expect(result.isError).toBe(false);
      const parsedValue = JSON.parse(result.content[0].text as string);
      expect(parsedValue).toEqual(mockBundleRequestResponse);
    },
  );

  it('should have correct tool properties', () => {
    expect(tool.name).toBe('generate-pulse-metric-value-insight-bundle');
    expect(tool.description).toContain(
      'Generate an insight bundle for the current aggregated value',
    );
    expect(tool.paramsSchema).toMatchObject({
      bundleRequest: expect.any(Object),
    });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockGeneratePulseMetricValueInsightBundle.mockRejectedValue(new Error(errorMessage));
    const result = await tool.callback(
      { bundleRequest },
      {
        signal: new AbortController().signal,
        requestId: 'test-request-id',
        sendNotification: vi.fn(),
        sendRequest: vi.fn(),
      },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return an error for missing bundleRequest', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockRejectedValue(
      new Error('bundleRequest is required'),
    );
    const result = await tool.callback({} as any, {
      signal: new AbortController().signal,
      requestId: 'test-request-id',
      sendNotification: vi.fn(),
      sendRequest: vi.fn(),
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('bundleRequest');
  });
});
