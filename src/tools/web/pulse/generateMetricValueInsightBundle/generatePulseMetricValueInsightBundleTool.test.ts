import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import {
  PulseDisabledError,
  PulseInsightsApiError,
  PulseNotAvailableError,
} from '../../../../errors/mcpToolError.js';
import { formatPulseInsightsApiError } from '../../../../errors/pulseInsightsApiError.js';
import { PulseInsightBundleType } from '../../../../sdks/tableau/types/pulse.js';
import { WebMcpServer } from '../../../../server.web.js';
import { stubDefaultEnvVars } from '../../../../testShared.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { exportedForTesting as resourceAccessCheckerExportedForTesting } from '../../resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getGeneratePulseMetricValueInsightBundleTool } from './generatePulseMetricValueInsightBundleTool.js';

const { resetResourceAccessCheckerSingleton } = resourceAccessCheckerExportedForTesting;
const mocks = vi.hoisted(() => ({
  mockGeneratePulseMetricValueInsightBundle: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        generatePulseMetricValueInsightBundle: mocks.mockGeneratePulseMetricValueInsightBundle,
      },
    }),
  ),
}));

describe('getGeneratePulseMetricValueInsightBundleTool', () => {
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

  // A populated response with `viz` blobs in both an insight result and a
  // summary result — used to exercise the `slim` viz-stripping path.
  const mockPopulatedResponse = {
    bundle_response: {
      result: {
        insight_groups: [
          {
            type: 'ban',
            insights: [
              {
                insight_type: 'popc',
                result: {
                  type: 'popc',
                  version: 1,
                  markup: 'There was a decrease of -$5.53 (-22.1%) over January 2024.',
                  viz: { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', mark: 'line' },
                  facts: {
                    target_period_value: { raw: 19.47, formatted: '$19.47' },
                    difference: {
                      direction: 'down',
                      relative: { raw: -0.221, formatted: '-22.1%' },
                    },
                  },
                  question: 'How has Sales changed?',
                  score: 1,
                },
              },
            ],
            summaries: [
              {
                result: {
                  id: 'summary-1',
                  markup: '<b>Summary</b>',
                  viz: { $schema: 'https://vega.github.io/schema/vega-lite/v5.json', mark: 'bar' },
                  generation_id: 'gen-1',
                },
              },
            ],
          },
        ],
        has_errors: false,
        characterization: 'CHARACTERIZATION_UNSPECIFIED',
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should call generatePulseMetricValueInsightBundle without bundleType and return Ok result', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );
    const result = await getToolResult();
    expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledWith(
      bundleRequest,
      'ban',
    );
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsedValue = JSON.parse(result.content[0].text);
    expect(parsedValue).toEqual(mockBundleRequestResponse);
  });

  it('should call generatePulseMetricValueInsightBundle with bundleType and return Ok result', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );
    const result = await getToolResult('springboard');
    expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledWith(
      bundleRequest,
      'springboard',
    );
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsedValue = JSON.parse(result.content[0].text);
    expect(parsedValue).toEqual(mockBundleRequestResponse);
  });

  it.each(['ban', 'springboard', 'basic', 'detail'] as const)(
    'should call generatePulseMetricValueInsightBundle with bundleType "%s" and return Ok result',
    async (bundleType) => {
      mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
        new Ok(mockBundleRequestResponse),
      );
      const result = await getToolResult(bundleType);
      expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledWith(
        bundleRequest,
        bundleType,
      );
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsedValue = JSON.parse(result.content[0].text);
      expect(parsedValue).toEqual(mockBundleRequestResponse);
    },
  );

  it('should have correct tool properties', () => {
    const tool = getGeneratePulseMetricValueInsightBundleTool(new WebMcpServer());
    expect(tool.name).toBe('generate-pulse-metric-value-insight-bundle');
    expect(tool.description).toContain(
      'Generate an insight bundle for the current aggregated value',
    );
    expect(tool.paramsSchema).toMatchObject({ bundleRequest: expect.any(Object) });
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockGeneratePulseMetricValueInsightBundle.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return an error for missing bundleRequest', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockRejectedValue(
      new Error('bundleRequest is required'),
    );
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('bundleRequest');
  });

  it('should return an error when executing the tool against Tableau Server', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new PulseNotAvailableError().toErr(),
    );
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is not available on Tableau Server.');
  });

  it('should return an error when Pulse is disabled', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new PulseDisabledError().toErr(),
    );
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is disabled on this Tableau Cloud site.');
  });

  it('should return actionable error message when API returns a known error code', async () => {
    const formatted = formatPulseInsightsApiError(400, { code: '400945', message: '0x30c0672c' });
    const apiError = new PulseInsightsApiError(formatted.message, 400, formatted.errorCode);
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(apiError.toErr());
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse Insights API returned HTTP 400');
    expect(result.content[0].text).toContain('Error code: 400945');
    expect(result.content[0].text).toContain('No measurement period present');
  });

  it('should return TabCode fallback when API returns an unknown error code', async () => {
    const formatted = formatPulseInsightsApiError(400, { code: '499999', message: '0xdeadbeef' });
    const apiError = new PulseInsightsApiError(formatted.message, 400, formatted.errorCode);
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(apiError.toErr());
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse Insights API returned HTTP 400');
    expect(result.content[0].text).toContain('TabCode: 0xdeadbeef');
  });

  it('should return a meaningful error for non-400 API failures', async () => {
    const formatted = formatPulseInsightsApiError(500, null);
    const apiError = new PulseInsightsApiError(formatted.message, 500);
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(apiError.toErr());
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse Insights API returned HTTP 500');
  });

  it('should return data source not allowed error when datasource is not allowed', async () => {
    vi.stubEnv('INCLUDE_DATASOURCE_IDS', 'some-other-datasource-luid');

    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toBe(
      'The set of allowed metric insights that can be queried is limited by the server configuration. One or more messages in the request contain only metrics derived from data sources that are not in the allowed set.',
    );

    expect(mocks.mockGeneratePulseMetricValueInsightBundle).not.toHaveBeenCalled();
  });

  it('strips viz from every insight and summary result when slim is true', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockPopulatedResponse),
    );
    const result = await getToolResult('ban', true);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    const group = parsed.bundle_response.result.insight_groups[0];
    // viz removed everywhere it appears...
    expect(group.insights[0].result).not.toHaveProperty('viz');
    expect(group.summaries[0].result).not.toHaveProperty('viz');
    // ...but the fields the UI renders are retained.
    expect(group.insights[0].result.facts).toEqual(
      mockPopulatedResponse.bundle_response.result.insight_groups[0].insights[0].result.facts,
    );
    expect(group.insights[0].result.markup).toBe(
      'There was a decrease of -$5.53 (-22.1%) over January 2024.',
    );
    expect(group.summaries[0].result.markup).toBe('<b>Summary</b>');
  });

  it('returns viz verbatim when slim is omitted or false', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockPopulatedResponse),
    );

    const defaultResult = await getToolResult('ban');
    invariant(defaultResult.content[0].type === 'text');
    const parsedDefault = JSON.parse(defaultResult.content[0].text);
    expect(parsedDefault).toEqual(mockPopulatedResponse);
    expect(parsedDefault).not.toHaveProperty('metric_context');

    const explicitFalse = await getToolResult('ban', false);
    invariant(explicitFalse.content[0].type === 'text');
    const parsedExplicitFalse = JSON.parse(explicitFalse.content[0].text);
    expect(parsedExplicitFalse).toEqual(mockPopulatedResponse);
    expect(parsedExplicitFalse).not.toHaveProperty('metric_context');
  });

  it('attaches a metric_context built from the bundleRequest when slim is true', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockPopulatedResponse),
    );
    const result = await getToolResult('ban', true);
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);

    // Curated flat fields.
    expect(parsed.metric_context.name).toBe('Pulse Metric');
    expect(parsed.metric_context.measure).toBe('Sales');
    expect(parsed.metric_context.time_dimension).toBe('Order Date');
    expect(parsed.metric_context.breakdown_dimensions).toEqual([]);
    // The full request input is echoed verbatim as an escape hatch — e.g. the
    // comparison kind lives under it.
    expect(parsed.metric_context.input).toEqual(bundleRequest.bundle_request.input);
    expect(parsed.metric_context.input.metric.metric_specification.comparison.comparison).toBe(
      'TIME_COMPARISON_PREVIOUS_PERIOD',
    );
    // viz is still stripped alongside the new metric_context.
    const group = parsed.bundle_response.result.insight_groups[0];
    expect(group.insights[0].result).not.toHaveProperty('viz');
    expect(group.summaries[0].result).not.toHaveProperty('viz');
  });

  it('passes through populated breakdown_dimensions in metric_context when slim is true', async () => {
    const bundleRequestWithDimensions = {
      bundle_request: {
        ...bundleRequest.bundle_request,
        input: {
          ...bundleRequest.bundle_request.input,
          metric: {
            ...bundleRequest.bundle_request.input.metric,
            extension_options: {
              ...bundleRequest.bundle_request.input.metric.extension_options,
              allowed_dimensions: ['Region', 'Category'],
            },
          },
        },
      },
    };
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockPopulatedResponse),
    );

    const tool = getGeneratePulseMetricValueInsightBundleTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    const result = await callback(
      { bundleRequest: bundleRequestWithDimensions, bundleType: 'ban', slim: true },
      getMockRequestHandlerExtra(),
    );
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.metric_context.breakdown_dimensions).toEqual(['Region', 'Category']);
  });

  async function getToolResult(
    bundleType?: PulseInsightBundleType,
    slim?: boolean,
  ): Promise<CallToolResult> {
    const tool = getGeneratePulseMetricValueInsightBundleTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    return await callback({ bundleRequest, bundleType, slim }, getMockRequestHandlerExtra());
  }
});
