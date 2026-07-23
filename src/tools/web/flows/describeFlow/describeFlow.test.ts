import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { mockFlow, mockOutputSteps } from '../getFlow/mockFlow.js';
import { getDescribeFlowTool } from './describeFlow.js';
import { mockFlowDocument } from './mockFlowDocument.js';

const mocks = vi.hoisted(() => ({
  mockGetFlowDocument: vi.fn(),
  mockQueryFlow: vi.fn(),
  mockIsFlowAllowed: vi.fn(),
}));

vi.mock('../../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isFlowAllowed: mocks.mockIsFlowAllowed,
  },
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      flowDocumentMethods: {
        getFlowDocument: mocks.mockGetFlowDocument,
      },
      flowsMethods: {
        queryFlow: mocks.mockQueryFlow,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    flowToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

/**
 * Builds an Error that `getHttpStatus` reads as an Axios HTTP error, optionally
 * carrying a Tableau REST error code in the response body (the shape Tableau
 * uses: `{ error: { code, summary, detail } }`).
 */
function axiosError(status: number, tableauErrorCode?: string): Error {
  const error = new Error(`HTTP ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number; data?: unknown };
  };
  error.isAxiosError = true;
  error.response = {
    status,
    ...(tableauErrorCode
      ? { data: { error: { code: tableauErrorCode, summary: 'Forbidden', detail: 'test' } } }
      : {}),
  };
  return error;
}

describe('describeFlowTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no bounded context, document downloads, metadata resolves.
    mocks.mockIsFlowAllowed.mockResolvedValue({ allowed: true });
    mocks.mockGetFlowDocument.mockResolvedValue(mockFlowDocument);
    mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
  });

  it('creates a tool instance with the correct properties', () => {
    const tool = getDescribeFlowTool(new WebMcpServer());
    expect(tool.name).toBe('describe-flow');
    expect(tool.description).toContain('underlying document');
    expect(tool.paramsSchema).toMatchObject({ flowId: expect.any(Object) });
  });

  it('is enabled when flow tools are turned on', async () => {
    const tool = getDescribeFlowTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled when flow tools are turned off', async () => {
    const { getConfig } = await import('../../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({
      flowToolsEnabled: false,
    } as ReturnType<typeof getConfig>);

    const tool = getDescribeFlowTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('summarizes the flow document and enriches it with metadata', async () => {
    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.flow.name).toBe(mockFlow.name);
    expect(parsed.stats).toMatchObject({ inputCount: 2, outputCount: 1, transformCount: 3 });
    expect(parsed.inputs).toHaveLength(2);
    expect(parsed.outputs).toHaveLength(1);
    expect(parsed.connections).toHaveLength(2);
    expect(parsed.fields).toBeUndefined();
    expect(parsed.mcp).toBeUndefined();

    expect(mocks.mockGetFlowDocument).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      flowId: mockFlow.id,
    });
  });

  it('includes per-step field schemas when includeFieldSchemas=true', async () => {
    const result = await getToolResult({ flowId: mockFlow.id, includeFieldSchemas: true });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.fields).toBeDefined();
    expect(parsed.fields['Orders.csv']).toBeDefined();
  });

  it('reuses the flow fetched by the access check instead of querying it again', async () => {
    mocks.mockIsFlowAllowed.mockResolvedValue({
      allowed: true,
      content: { flow: mockFlow, outputSteps: mockOutputSteps },
    });

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.flow.name).toBe(mockFlow.name);
    expect(mocks.mockQueryFlow).not.toHaveBeenCalled();
  });

  it('returns an error and downloads nothing when the flow is not allowed', async () => {
    mocks.mockIsFlowAllowed.mockResolvedValue({
      allowed: false,
      message:
        'The set of allowed flows that can be queried is limited by the server configuration.',
    });

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('limited by the server configuration');
    expect(mocks.mockGetFlowDocument).not.toHaveBeenCalled();
  });

  it('maps a 403 with Tableau code 403200 to a clear "experimental API not enabled" error', async () => {
    mocks.mockGetFlowDocument.mockRejectedValue(axiosError(403, '403200'));

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('experimental flow-document API is not enabled');
  });

  it('maps a non-403200 403 to a forbidden/download-permission error (not "API disabled")', async () => {
    // A readable flow whose caller lacks download permission / scope returns a
    // 403 with a different Tableau code; it must NOT be reported as the API
    // being disabled.
    mocks.mockGetFlowDocument.mockRejectedValue(axiosError(403, '403126'));

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('experimental flow-document API is not enabled');
    expect(result.content[0].text).toContain('Not authorized to download');
    expect(result.content[0].text).toContain('tableau:flows:download');
  });

  it('treats a 403 with no identifiable Tableau code as a forbidden error', async () => {
    // No body code at all (e.g. a generic proxy 403): default to the safe
    // forbidden message rather than claiming the feature is disabled.
    mocks.mockGetFlowDocument.mockRejectedValue(axiosError(403));

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toContain('experimental flow-document API is not enabled');
    expect(result.content[0].text).toContain('Not authorized to download');
  });

  it('maps a 404 to a clear "no flow document available" error', async () => {
    mocks.mockGetFlowDocument.mockRejectedValue(axiosError(404));

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No flow document is available');
  });

  it('still returns the structural summary (with a note) when metadata fails', async () => {
    mocks.mockQueryFlow.mockRejectedValue(new Error('metadata boom'));

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.stats.inputCount).toBe(2);
    expect(parsed.mcp.warnings[0]).toMatchObject({
      type: 'METADATA_FETCH_FAILED',
      severity: 'WARNING',
      affectedField: 'flow',
    });
    expect(parsed.mcp.warnings[0].message).toContain('Could not load flow metadata');
  });

  it('never surfaces auth headers in the response', async () => {
    const result = await getToolResult({ flowId: mockFlow.id });
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).not.toMatch(/X-Tableau-Auth/);
  });
});

async function getToolResult(params: {
  flowId: string;
  includeFieldSchemas?: boolean;
}): Promise<CallToolResult> {
  const tool = getDescribeFlowTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      flowId: params.flowId,
      includeFieldSchemas: params.includeFieldSchemas ?? false,
    },
    getMockRequestHandlerExtra(),
  );
}
