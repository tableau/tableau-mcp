import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { PulseMetricDefinition } from '../../../sdks/tableau/types/pulse.js';
import { Server } from '../../../server.js';
import { getListAllPulseMetricDefinitionsTool } from './listAllPulseMetricDefinitions.js';

const mockPulseMetricDefinitions: PulseMetricDefinition[] = [
  {
    metadata: { name: 'Pulse Metric 1', id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C4' },
    specification: { datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11' } },
    metrics: [
      { id: 'CF32DDCC-362B-4869-9487-37DA4D152552', is_default: true, is_followed: false },
      { id: 'CF32DDCC-362B-4869-9487-37DA4D152553', is_default: false, is_followed: true },
    ],
  } as PulseMetricDefinition,
  {
    metadata: { name: 'Pulse Metric 2', id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C5' },
    specification: { datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A12' } },
    metrics: [{ id: 'CF32DDCC-362B-4869-9487-37DA4D152554', is_default: true, is_followed: false }],
  } as PulseMetricDefinition,
  {
    metadata: { name: 'Pulse Metric 3', id: 'BBC908D8-29ED-48AB-A78E-ACF8A424C8C6' },
    specification: { datasource: { id: 'A6FC3C9F-4F40-4906-8DB0-AC70C5FB5A11' } },
    metrics: [],
  } as unknown as PulseMetricDefinition,
];

const mocks = vi.hoisted(() => ({
  mockListAllPulseMetricDefinitions: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        listAllPulseMetricDefinitions: mocks.mockListAllPulseMetricDefinitions,
      },
      siteId: 'test-site-id',
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
    mocks.mockListAllPulseMetricDefinitions.mockResolvedValue(mockPulseMetricDefinitions);
    const result = await getToolResult({ view });
    expect(result.isError).toBe(false);
    const parsedValue = JSON.parse(result.content[0].text as string);
    expect(parsedValue).toEqual(mockPulseMetricDefinitions);
    expect(mocks.mockListAllPulseMetricDefinitions).toHaveBeenCalledWith(view);
  });

  it('should list pulse metric definitions with no view (default)', async () => {
    mocks.mockListAllPulseMetricDefinitions.mockResolvedValue(mockPulseMetricDefinitions);
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
