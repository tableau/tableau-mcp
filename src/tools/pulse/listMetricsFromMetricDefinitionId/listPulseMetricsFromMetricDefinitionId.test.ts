import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { PulseDisabledError } from '../../../sdks/tableau/methods/pulseMethods.js';
import { Server } from '../../../server.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../testContext.mock.js';
import { mockPulseMetricDefinitions } from '../mockPulseMetricDefinitions.js';
import { getListPulseMetricsFromMetricDefinitionIdTool } from './listPulseMetricsFromMetricDefinitionId.js';

const mocks = vi.hoisted(() => ({
  mockListPulseMetricsFromMetricDefinitionId: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        listPulseMetricsFromMetricDefinitionId: mocks.mockListPulseMetricsFromMetricDefinitionId,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listPulseMetricsFromMetricDefinitionIdTool', () => {
  const mockPulseMetrics = mockPulseMetricDefinitions.flatMap((definition) => definition.metrics);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listPulseMetricsFromMetricDefinitionIdTool =
      getListPulseMetricsFromMetricDefinitionIdTool(new Server());
    expect(listPulseMetricsFromMetricDefinitionIdTool.name).toBe(
      'list-pulse-metrics-from-metric-definition-id',
    );
    expect(listPulseMetricsFromMetricDefinitionIdTool.description).toContain(
      'Retrieves a list of published Pulse Metrics from a Pulse Metric Definition',
    );
    expect(listPulseMetricsFromMetricDefinitionIdTool.paramsSchema).toMatchObject({
      pulseMetricDefinitionID: expect.any(Object),
    });
  });

  it('should list pulse metrics for a given definition ID', async () => {
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValue(new Ok(mockPulseMetrics));
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockListPulseMetricsFromMetricDefinitionId).toHaveBeenCalledWith(
      'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    );
    invariant(result.content[0].type === 'text');
    const parsedValue = JSON.parse(result.content[0].text);
    expect(parsedValue).toEqual(mockPulseMetrics);
  });

  it('should require a non-empty pulseMetricDefinitionID', async () => {
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockRejectedValue({
      errorCode: '-32602',
      message:
        'Invalid arguments for tool list-pulse-metrics: String must contain 36 character(s) "path": "pulseMetricDefinitionID"',
    });
    const result = await getToolResult({ pulseMetricDefinitionID: '' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('pulseMetricDefinitionID');
    expect(result.content[0].text).toContain('Invalid arguments for tool list-pulse-metrics');
    expect(result.content[0].text).toContain('String must contain 36 character(s)');
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return an error when executing the tool against Tableau Server', async () => {
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValue(
      new Err(new PulseDisabledError('tableau-server', 404)),
    );
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is not available on Tableau Server.');
  });

  it('should return an error when Pulse is disabled', async () => {
    mocks.mockListPulseMetricsFromMetricDefinitionId.mockResolvedValue(
      new Err(new PulseDisabledError('pulse-disabled', 400)),
    );
    const result = await getToolResult({
      pulseMetricDefinitionID: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C3',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is disabled on this Tableau Cloud site.');
  });
});

async function getToolResult(params: { pulseMetricDefinitionID: string }): Promise<CallToolResult> {
  const listPulseMetricsFromMetricDefinitionIdTool = getListPulseMetricsFromMetricDefinitionIdTool(
    new Server(),
  );
  const callback = await Provider.from(listPulseMetricsFromMetricDefinitionIdTool.callback);
  return await callback(params, getMockRequestHandlerExtra());
}
