import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Err, Ok } from 'ts-results-es';

import { PulseDisabledError } from '../../../sdks/tableau/methods/pulseMethods.js';
import { Server } from '../../../server.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { mockPulseMetricDefinitions } from '../mockPulseMetricDefinitions.js';
import { getListAllPulseMetricDefinitionsTool } from './listAllPulseMetricDefinitions.js';

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
    mocks.mockListAllPulseMetricDefinitions.mockResolvedValue(
      new Ok({
        pagination: { next_page_token: undefined },
        definitions: mockPulseMetricDefinitions,
      }),
    );
    const result = await getToolResult({ view });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsedValue = JSON.parse(result.content[0].text);
    expect(parsedValue).toEqual(mockPulseMetricDefinitions);
    expect(mocks.mockListAllPulseMetricDefinitions).toHaveBeenCalledWith(
      view,
      undefined,
      undefined,
    );
  });

  it('should list pulse metric definitions with no view (default)', async () => {
    mocks.mockListAllPulseMetricDefinitions.mockResolvedValue(
      new Ok({
        pagination: { next_page_token: undefined },
        definitions: mockPulseMetricDefinitions,
      }),
    );
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsedValue = JSON.parse(result.content[0].text);
    expect(parsedValue).toEqual(mockPulseMetricDefinitions);
    expect(mocks.mockListAllPulseMetricDefinitions).toHaveBeenCalledWith(
      undefined,
      undefined,
      undefined,
    );
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListAllPulseMetricDefinitions.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ view: 'DEFINITION_VIEW_BASIC' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
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
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('view');
    expect(result.content[0].text).toContain('Enumeration value must be one of');
    expect(result.content[0].text).toContain(
      'DEFINITION_VIEW_BASIC, DEFINITION_VIEW_FULL, DEFINITION_VIEW_DEFAULT',
    );
  });

  it('should return an error when executing the tool against Tableau Server', async () => {
    mocks.mockListAllPulseMetricDefinitions.mockResolvedValue(
      new Err(new PulseDisabledError('tableau-server', 404)),
    );
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is not available on Tableau Server.');
  });

  it('should return an error when Pulse is disabled', async () => {
    mocks.mockListAllPulseMetricDefinitions.mockResolvedValue(
      new Err(new PulseDisabledError('pulse-disabled', 400)),
    );
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is disabled on this Tableau Cloud site.');
  });
});

async function getToolResult(params: {
  view?: 'DEFINITION_VIEW_BASIC' | 'DEFINITION_VIEW_FULL' | 'DEFINITION_VIEW_DEFAULT';
}): Promise<CallToolResult> {
  const listAllPulseMetricDefinitionsTool = getListAllPulseMetricDefinitionsTool(new Server());
  const callback = await Provider.from(listAllPulseMetricDefinitionsTool.callback);
  return await callback(
    { view: params.view, limit: undefined, pageSize: undefined },
    getMockRequestHandlerExtra(),
  );
}
