import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { Err, Ok } from 'ts-results-es';

import type { PulseMetricDefinition } from '../../../sdks/tableau/types/pulse.js';
import {
  createValidPulseMetric,
  createValidPulseMetricDefinition,
} from '../../../sdks/tableau/types/pulse.test.js';
import { Server } from '../../../server.js';
import { mockDatasources } from '../../listDatasources/mockDatasources.js';
import { getListAllPulseMetricDefinitionsTool } from './listAllPulseMetricDefinitions.js';

export const mockPulseMetricDefinitions: Array<PulseMetricDefinition> =
  mockDatasources.datasources.map((datasource, index) =>
    createValidPulseMetricDefinition({
      metadata: {
        name: `Pulse Metric ${index + 1}`,
        id: randomUUID(),
        description: `Pulse Metric ${index + 1} Description`,
        schema_version: '1.0',
        metric_version: 1,
        definition_version: 1,
      },
      specification: {
        datasource: {
          id: datasource.id,
        },
        basic_specification: {
          measure: { field: 'sales', aggregation: 'SUM' },
          time_dimension: { field: 'order_date' },
          filters: [],
        },
        is_running_total: false,
      },
      metrics: [1, 2].map((i) =>
        createValidPulseMetric({
          id: randomUUID(),
          is_default: i === 1,
          is_followed: i === 2,
        }),
      ),
    }),
  );

const mocks = vi.hoisted(() => ({
  mockListAllPulseMetricDefinitions: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        listAllPulseMetricDefinitions: mocks.mockListAllPulseMetricDefinitions,
      },
    }),
  ),
}));

describe('listAllPulseMetricDefinitionsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listAllPulseMetricDefinitionsTool = getListAllPulseMetricDefinitionsTool(new Server());
    expect(listAllPulseMetricDefinitionsTool.name).toBe('list-all-pulse-metric-definitions');
    expect(listAllPulseMetricDefinitionsTool.description).toContain(
      'Retrieves a list of all published Pulse Metric Definitions',
    );
    expect(listAllPulseMetricDefinitionsTool.paramsSchema).toMatchObject({
      view: expect.any(Object),
    });
  });

  it.each<{
    view: 'DEFINITION_VIEW_BASIC' | 'DEFINITION_VIEW_FULL' | 'DEFINITION_VIEW_DEFAULT';
    label: string;
  }>([
    { view: 'DEFINITION_VIEW_BASIC', label: 'basic view' },
    { view: 'DEFINITION_VIEW_FULL', label: 'full view' },
    { view: 'DEFINITION_VIEW_DEFAULT', label: 'default view' },
  ])('should list pulse metric definitions with $label', async ({ view }) => {
    mocks.mockListAllPulseMetricDefinitions.mockResolvedValue(new Ok(mockPulseMetricDefinitions));
    const result = await getToolResult({ view });
    expect(result.isError).toBe(false);
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockPulseMetricDefinitions);
    expect(mocks.mockListAllPulseMetricDefinitions).toHaveBeenCalledWith(view);
  });

  it('should list pulse metric definitions with no view (default)', async () => {
    mocks.mockListAllPulseMetricDefinitions.mockResolvedValue(new Ok(mockPulseMetricDefinitions));
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockPulseMetricDefinitions);
    expect(mocks.mockListAllPulseMetricDefinitions).toHaveBeenCalledWith(undefined);
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListAllPulseMetricDefinitions.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ view: 'DEFINITION_VIEW_BASIC' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return an error for an invalid view value', async () => {
    mocks.mockListAllPulseMetricDefinitions.mockRejectedValue({
      errorCode: '-32602',
      message:
        'Invalid arguments for tool list-all-pulse-metric-definitions: Enumeration value must be one of: DEFINITION_VIEW_BASIC, DEFINITION_VIEW_FULL, DEFINITION_VIEW_DEFAULT "path": "view"',
    });
    // @ts-expect-error: intentionally passing invalid value for testing
    const result = await getToolResult({ view: 'INVALID_VIEW' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('view');
    expect(result.content[0].text).toContain('Enumeration value must be one of');
    expect(result.content[0].text).toContain(
      'DEFINITION_VIEW_BASIC, DEFINITION_VIEW_FULL, DEFINITION_VIEW_DEFAULT',
    );
  });

  it('should return an error when executing the tool against Tableau Server', async () => {
    mocks.mockListAllPulseMetricDefinitions.mockResolvedValue(new Err('tableau-server'));
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Pulse is not available on Tableau Server.');
  });

  it('should return an error when Pulse is disabled', async () => {
    mocks.mockListAllPulseMetricDefinitions.mockResolvedValue(new Err('pulse-disabled'));
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Pulse is disabled on this Tableau Cloud site.');
  });
});

async function getToolResult(params: {
  view?: 'DEFINITION_VIEW_BASIC' | 'DEFINITION_VIEW_FULL' | 'DEFINITION_VIEW_DEFAULT';
}): Promise<CallToolResult> {
  const listAllPulseMetricDefinitionsTool = getListAllPulseMetricDefinitionsTool(new Server());
  return await listAllPulseMetricDefinitionsTool.callback(params, {
    signal: new AbortController().signal,
    requestId: 'test-request-id',
    sendNotification: vi.fn(),
    sendRequest: vi.fn(),
  });
}
