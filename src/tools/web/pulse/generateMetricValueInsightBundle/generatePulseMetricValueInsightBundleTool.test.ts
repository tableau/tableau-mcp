import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { AxiosError } from 'axios';
import { Err, Ok } from 'ts-results-es';

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
  mockReadMetadata: vi.fn(),
  mockQueryDatasource: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      siteId: 'site-id',
      pulseMethods: {
        generatePulseMetricValueInsightBundle: mocks.mockGeneratePulseMetricValueInsightBundle,
      },
      vizqlDataServiceMethods: {
        readMetadata: mocks.mockReadMetadata,
      },
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
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

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubDefaultEnvVars();
    resetResourceAccessCheckerSingleton();
    mocks.mockReadMetadata.mockResolvedValue(new Ok({ data: [] }));
    mocks.mockQueryDatasource.mockResolvedValue({ name: 'Some Datasource' });
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

  it('resolves field captions to fieldName using VDS metadata before calling Pulse', async () => {
    // The Insight Service validates `field` against HBI metadata's fieldName,
    // not fieldCaption. Callers build bundleRequest from captions (all
    // getDatasourceMetadata exposes), so a calc field's caption must be
    // resolved to its fieldName before the request reaches Pulse.
    mocks.mockReadMetadata.mockResolvedValue(
      new Ok({
        data: [
          { fieldCaption: 'Sales', fieldName: 'Calculation_0013913069531140' },
          { fieldCaption: 'Order Date', fieldName: 'Order Date' },
        ],
      }),
    );
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );

    const result = await getToolResult();

    expect(mocks.mockReadMetadata).toHaveBeenCalledWith({
      datasource: { datasourceLuid: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11' },
    });
    const [sentRequest] = mocks.mockGeneratePulseMetricValueInsightBundle.mock.calls[0];
    const basicSpec = sentRequest.bundle_request.input.metric.definition.basic_specification;
    expect(basicSpec.measure.field).toBe('Calculation_0013913069531140');
    expect(basicSpec.time_dimension.field).toBe('Order Date');
    expect(result.isError).toBe(false);
  });

  it('forwards the request unchanged when metadata cannot be read', async () => {
    mocks.mockReadMetadata.mockResolvedValue(new Err('boom'));
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );

    const result = await getToolResult();

    expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledWith(
      bundleRequest,
      'ban',
    );
    expect(result.isError).toBe(false);
  });

  it('forwards the request unchanged when readMetadata throws instead of returning Err', async () => {
    // readMetadata only returns Err for a 404 ('feature-disabled'); any other
    // failure (auth, 5xx, network) throws instead.
    mocks.mockReadMetadata.mockRejectedValue(
      new AxiosError('Internal Server Error', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status: 500,
        statusText: 'Internal Server Error',
        data: {},
        headers: {},
        config: {} as any,
      }),
    );
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );

    const result = await getToolResult();

    expect(mocks.mockGeneratePulseMetricValueInsightBundle).toHaveBeenCalledWith(
      bundleRequest,
      'ban',
    );
    expect(result.isError).toBe(false);
  });

  it('sets id_type to DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE when queryDatasource returns an embedded contentUrl', async () => {
    // Pulse must always call HBI directly (never a cached query result) for
    // embedded workbook datasources. Callers can't be relied on to set
    // id_type themselves, so the tool detects it: the Datasources REST API
    // resolves embedded/workbook datasource LUIDs too, but marks them with a
    // contentUrl of the form '$embedded$_<workbookLuid>' instead of 404ing.
    mocks.mockQueryDatasource.mockResolvedValue({
      name: 'SalesCloud',
      contentUrl: '$embedded$_857cae8f-aaee-4e7a-ad78-851b465b5121',
    });
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );

    const result = await getToolResult();

    expect(mocks.mockQueryDatasource).toHaveBeenCalledWith({
      siteId: 'site-id',
      datasourceId: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11',
    });
    const [sentRequest] = mocks.mockGeneratePulseMetricValueInsightBundle.mock.calls[0];
    expect(sentRequest.bundle_request.input.metric.definition.datasource).toEqual({
      id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11',
      id_type: 'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE',
    });
    expect(result.isError).toBe(false);
  });

  it('sets id_type to DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE when queryDatasource does not recognize the LUID at all (404)', async () => {
    mocks.mockQueryDatasource.mockRejectedValue(
      new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 404,
        statusText: 'Not Found',
        data: {},
        headers: {},
        config: {} as any,
      }),
    );
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );

    const result = await getToolResult();

    const [sentRequest] = mocks.mockGeneratePulseMetricValueInsightBundle.mock.calls[0];
    expect(sentRequest.bundle_request.input.metric.definition.datasource).toEqual({
      id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11',
      id_type: 'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE',
    });
    expect(result.isError).toBe(false);
  });

  it('defaults to DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE (and logs) when queryDatasource fails for a non-404 reason', async () => {
    // A published/embedded lookup that fails for an operational reason (auth,
    // 5xx, network) can't be distinguished from a genuinely unknown LUID, so
    // it defaults the same way as a 404 — but this case is logged separately.
    mocks.mockQueryDatasource.mockRejectedValue(
      new AxiosError('Internal Server Error', 'ERR_BAD_RESPONSE', undefined, undefined, {
        status: 500,
        statusText: 'Internal Server Error',
        data: {},
        headers: {},
        config: {} as any,
      }),
    );
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );

    const result = await getToolResult();

    const [sentRequest] = mocks.mockGeneratePulseMetricValueInsightBundle.mock.calls[0];
    expect(sentRequest.bundle_request.input.metric.definition.datasource).toEqual({
      id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11',
      id_type: 'DATASOURCE_ID_TYPE_WORKBOOK_DATASOURCE',
    });
    expect(result.isError).toBe(false);
  });

  it('leaves id_type unset when the datasource resolves as a published datasource', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new Ok(mockBundleRequestResponse),
    );

    const result = await getToolResult();

    const [sentRequest] = mocks.mockGeneratePulseMetricValueInsightBundle.mock.calls[0];
    expect(sentRequest.bundle_request.input.metric.definition.datasource).toEqual({
      id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11',
    });
    expect(result.isError).toBe(false);
  });

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

  it('should return Tableau Server error for bare 404 without error code', async () => {
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(
      new PulseNotAvailableError().toErr(),
    );
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is not available on Tableau Server.');
  });

  it('should return actionable error for 404 with a Pulse error code', async () => {
    const formatted = formatPulseInsightsApiError(404, { code: '404900', message: '0x00000000' });
    const apiError = new PulseInsightsApiError(formatted.message, 404, formatted.errorCode);
    mocks.mockGeneratePulseMetricValueInsightBundle.mockResolvedValue(apiError.toErr());
    const result = await getToolResult();
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse Insights API returned HTTP 404');
    expect(result.content[0].text).toContain('404900');
    expect(result.content[0].text).not.toContain('Tableau Server');
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

  async function getToolResult(bundleType?: PulseInsightBundleType): Promise<CallToolResult> {
    const tool = getGeneratePulseMetricValueInsightBundleTool(new WebMcpServer());
    const callback = await Provider.from(tool.callback);
    return await callback({ bundleRequest, bundleType }, getMockRequestHandlerExtra());
  }
});
