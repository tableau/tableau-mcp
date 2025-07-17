import { Server } from '../../../server.js';
import { getGeneratePulseMetricValueInsightBundleTool } from './generatePulseMetricValueInsightBundleTool.js';

const mocks = vi.hoisted(() => ({
  mockGeneratePulseMetricValueInsightBundle: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  getNewRestApiInstanceAsync: vi.fn().mockResolvedValue({
    pulseMethods: {
      generatePulseMetricValueInsightBundle: mocks.mockGeneratePulseMetricValueInsightBundle,
    },
  }),
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
      },
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
            },
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

  it('should call generatePulseMetricValueInsightBundle and return Ok result', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(mockBundleRequestResponse);
    const result = await tool.callback({ bundleRequest }, { requestId: 'req-1' });
    expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledWith(bundleRequest);
    expect(result.isError).toBe(false);
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockBundleRequestResponse);
  });
});
