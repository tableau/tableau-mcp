import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Ok } from 'ts-results-es';

import { PulseDisabledError, PulseNotAvailableError } from '../../../../errors/mcpToolError.js';
import * as loggerModule from '../../../../logging/logger.js';
import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { mockPulseMetricDefinitions } from '../mockPulseMetricDefinitions.js';
import { getListPulseMetricDefinitionsFromDefinitionIdsTool } from './listPulseMetricDefinitionsFromDefinitionIds.js';

const mocks = vi.hoisted(() => ({
  mockListPulseMetricDefinitionsFromMetricDefinitionIds: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      pulseMethods: {
        listPulseMetricDefinitionsFromMetricDefinitionIds:
          mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

beforeEach(() => {
  vi.spyOn(loggerModule, 'log').mockImplementation(() => {});
});

describe('listPulseMetricDefinitionsFromDefinitionIdsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listPulseMetricDefinitionsFromDefinitionIdsTool =
      getListPulseMetricDefinitionsFromDefinitionIdsTool(new WebMcpServer());
    expect(listPulseMetricDefinitionsFromDefinitionIdsTool.name).toBe(
      'list-pulse-metric-definitions-from-definition-ids',
    );
    expect(listPulseMetricDefinitionsFromDefinitionIdsTool.description).toContain(
      'Retrieves a list of specific Pulse Metric Definitions',
    );
    expect(listPulseMetricDefinitionsFromDefinitionIdsTool.paramsSchema).toMatchObject({
      metricDefinitionIds: expect.any(Object),
      view: expect.any(Object),
    });
  });

  it('should bound metricDefinitionIds at 2,000 ids', async () => {
    const listPulseMetricDefinitionsFromDefinitionIdsTool =
      getListPulseMetricDefinitionsFromDefinitionIdsTool(new WebMcpServer());
    const { metricDefinitionIds } = await Provider.from(
      listPulseMetricDefinitionsFromDefinitionIdsTool.paramsSchema,
    );
    const ids = (count: number): string[] =>
      Array.from(
        { length: count },
        (_, index) => `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
      );

    expect(metricDefinitionIds.safeParse(ids(2000)).success).toBe(true);

    const tooMany = metricDefinitionIds.safeParse(ids(2001));
    expect(tooMany.success).toBe(false);
    invariant(!tooMany.success);
    expect(tooMany.error.issues).toContainEqual(
      expect.objectContaining({ code: 'too_big', maximum: 2000, path: [] }),
    );

    const none = metricDefinitionIds.safeParse([]);
    expect(none.success).toBe(false);
    invariant(!none.success);
    expect(none.error.issues).toContainEqual(
      expect.objectContaining({ code: 'too_small', minimum: 1, path: [] }),
    );
  });

  it.each<{
    view: 'DEFINITION_VIEW_BASIC' | 'DEFINITION_VIEW_FULL' | 'DEFINITION_VIEW_DEFAULT';
    label: string;
  }>([
    { view: 'DEFINITION_VIEW_BASIC', label: 'basic view' },
    { view: 'DEFINITION_VIEW_FULL', label: 'full view' },
    { view: 'DEFINITION_VIEW_DEFAULT', label: 'default view' },
  ])('should list pulse metric definitions from IDs with $label', async ({ view }) => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockResolvedValue(
      new Ok(mockPulseMetricDefinitions),
    );
    const result = await getToolResult({
      metricDefinitionIds: [
        mockPulseMetricDefinitions[0].metadata.id,
        mockPulseMetricDefinitions[1].metadata.id,
        mockPulseMetricDefinitions[2].metadata.id,
      ],
      view,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsedValue = JSON.parse(result.content[0].text);
    expect(parsedValue).toEqual(mockPulseMetricDefinitions);
    expect(mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds).toHaveBeenCalledWith(
      [
        mockPulseMetricDefinitions[0].metadata.id,
        mockPulseMetricDefinitions[1].metadata.id,
        mockPulseMetricDefinitions[2].metadata.id,
      ],
      view,
    );
  });

  it('should list pulse metric definitions from IDs with no view (default)', async () => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockResolvedValue(
      new Ok(mockPulseMetricDefinitions),
    );
    const result = await getToolResult({
      metricDefinitionIds: [
        mockPulseMetricDefinitions[0].metadata.id,
        mockPulseMetricDefinitions[1].metadata.id,
        mockPulseMetricDefinitions[2].metadata.id,
      ],
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsedValue = JSON.parse(result.content[0].text);
    expect(parsedValue).toEqual(mockPulseMetricDefinitions);
    expect(mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds).toHaveBeenCalledWith(
      [
        mockPulseMetricDefinitions[0].metadata.id,
        mockPulseMetricDefinitions[1].metadata.id,
        mockPulseMetricDefinitions[2].metadata.id,
      ],
      undefined,
    );
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockRejectedValue(
      new Error(errorMessage),
    );
    const result = await getToolResult({
      metricDefinitionIds: [mockPulseMetricDefinitions[0].metadata.id],
      view: 'DEFINITION_VIEW_BASIC',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  it('should return an error for an invalid view value', async () => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockRejectedValue({
      errorCode: '-32602',
      message:
        'Invalid arguments for tool list-pulse-metric-definitions-from-definition-ids: Enumeration value must be one of: DEFINITION_VIEW_BASIC, DEFINITION_VIEW_FULL, DEFINITION_VIEW_DEFAULT "path": "view"',
    });
    // Intentionally passing invalid value for testing
    const result = await getToolResult({
      metricDefinitionIds: [mockPulseMetricDefinitions[0].metadata.id],
      view: 'INVALID_VIEW',
    } as any);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('view');
    expect(result.content[0].text).toContain('Enumeration value must be one of');
    expect(result.content[0].text).toContain(
      'DEFINITION_VIEW_BASIC, DEFINITION_VIEW_FULL, DEFINITION_VIEW_DEFAULT',
    );
  });

  it('should return an error for missing metricDefinitionIds', async () => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockRejectedValue({
      errorCode: '-32602',
      message: `MCP error -32602: MCP error -32602: Invalid arguments for tool list-pulse-metric-definitions-from-definition-ids: [
        {
          "code": "too_small",
          "minimum": 1,
          "type": "array",
          "inclusive": true,
          "exact": false,
          "message": "Array must contain at least 1 element(s)",
          "path": [
            "metricDefinitionIds"
          ]
        }
      ]`,
    });
    // Intentionally omitting required parameter for testing
    const result = await getToolResult({} as any);
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('metricDefinitionIds');
    expect(result.content[0].text).toContain('Array must contain at least 1 element(s)');
  });

  it('should return an error for is metricDefinitionId is too small', async () => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockRejectedValue({
      errorCode: '-32602',
      message: `MCP error -32602: MCP error -32602: Invalid arguments for tool list-pulse-metric-definitions-from-definition-ids: [
        {
          "code": "too_small",
          "minimum": 36,
          "type": "string",
          "inclusive": true,
          "exact": true,
          "message": "String must contain exactly 36 character(s)",
          "path": [
            "metricDefinitionIds",
            0
          ]
        }
      ]`,
    });
    // Intentionally omitting required parameter for testing
    const result = await getToolResult({
      metricDefinitionIds: ['123'],
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('metricDefinitionIds');
    expect(result.content[0].text).toContain('String must contain exactly 36 character(s)');
  });

  it('should return an error when executing the tool against Tableau Server', async () => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockResolvedValue(
      new PulseNotAvailableError().toErr(),
    );
    const result = await getToolResult({
      metricDefinitionIds: [
        mockPulseMetricDefinitions[0].metadata.id,
        mockPulseMetricDefinitions[1].metadata.id,
        mockPulseMetricDefinitions[2].metadata.id,
      ],
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is not available on Tableau Server.');
  });

  it('should return an error when Pulse is disabled', async () => {
    mocks.mockListPulseMetricDefinitionsFromMetricDefinitionIds.mockResolvedValue(
      new PulseDisabledError().toErr(),
    );
    const result = await getToolResult({
      metricDefinitionIds: [
        mockPulseMetricDefinitions[0].metadata.id,
        mockPulseMetricDefinitions[1].metadata.id,
        mockPulseMetricDefinitions[2].metadata.id,
      ],
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Pulse is disabled on this Tableau Cloud site.');
  });
});

async function getToolResult(params: {
  metricDefinitionIds: string[];
  view?: 'DEFINITION_VIEW_BASIC' | 'DEFINITION_VIEW_FULL' | 'DEFINITION_VIEW_DEFAULT';
}): Promise<CallToolResult> {
  const listPulseMetricDefinitionsFromDefinitionIdsTool =
    getListPulseMetricDefinitionsFromDefinitionIdsTool(new WebMcpServer());
  const callback = await Provider.from(listPulseMetricDefinitionsFromDefinitionIdsTool.callback);
  return await callback(
    { metricDefinitionIds: params.metricDefinitionIds, view: params.view },
    getMockRequestHandlerExtra(),
  );
}
