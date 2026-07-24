import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from '../../../../config.js';
import { RestApi } from '../../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getCancelFlowRunTool } from './cancelFlowRun.js';

const mocks = vi.hoisted(() => ({
  mockCancelFlowRun: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      flowsMethods: {
        cancelFlowRun: mocks.mockCancelFlowRun,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    flowToolsEnabled: true,
    flowWriteToolsEnabled: true,
    productTelemetryEnabled: false,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

const FLOW_RUN_ID = '1bff10bb-57ae-43df-8774-a86d14aef432';
const ORIGINAL_REST_API_VERSION = RestApi.version;

describe('cancelFlowRunTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    RestApi.version = '3.10';
    vi.spyOn(RestApi, 'versionIsAtLeast').mockReturnValue(true);
  });

  afterAll(() => {
    vi.restoreAllMocks();
    RestApi.version = ORIGINAL_REST_API_VERSION;
  });

  it('creates a tool instance with correct properties', async () => {
    const tool = getCancelFlowRunTool(new WebMcpServer());
    expect(tool.name).toBe('cancel-flow-run');
    expect(tool.description).toContain(
      'Requests cancellation of a **queued or in-progress Tableau Prep flow run**',
    );
    expect(tool.paramsSchema).toHaveProperty('flowRunId');
    const annotations = await Provider.from(tool.annotations);
    expect(annotations?.readOnlyHint).toBe(false);
    expect(annotations?.destructiveHint).toBe(true);
    expect(annotations?.idempotentHint).toBe(false);
  });

  it('is enabled when the flow write flag is on', () => {
    const tool = getCancelFlowRunTool(new WebMcpServer());
    expect(tool.disabled).toBeFalsy();
  });

  it('is disabled when the flow write flag is off (state-mutating tool is opt-in)', () => {
    vi.mocked(getConfig).mockReturnValueOnce({
      flowWriteToolsEnabled: false,
      productTelemetryEnabled: false,
      productTelemetryEndpoint: 'https://test.com',
      server: 'https://test.tableau.com',
    } as unknown as ReturnType<typeof getConfig>);
    const tool = getCancelFlowRunTool(new WebMcpServer());
    expect(tool.disabled).toBe(true);
  });

  it('refuses on Tableau REST API versions before 3.10', async () => {
    vi.mocked(RestApi.versionIsAtLeast).mockReturnValue(false);

    const result = await getToolResult({ flowRunId: FLOW_RUN_ID });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('REST API version 3.10 or later');
    expect(mocks.mockCancelFlowRun).not.toHaveBeenCalled();
  });

  it('requests cancellation and returns an asynchronous cancelStatus note', async () => {
    mocks.mockCancelFlowRun.mockResolvedValue(undefined);
    const result = await getToolResult({ flowRunId: FLOW_RUN_ID });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.mcp.cancelStatus).toContain('may still finish as Completed or Failed');
    expect(mocks.mockCancelFlowRun).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      flowRunId: FLOW_RUN_ID,
    });
  });

  it('fails closed under a bounded context (cannot prove the run is in scope)', async () => {
    const result = await getToolResult(
      { flowRunId: FLOW_RUN_ID },
      { boundedContext: { projectIds: new Set(['p1']), tags: null } },
    );
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('restricted to an allowed set');
    expect(mocks.mockCancelFlowRun).not.toHaveBeenCalled();
  });

  it('maps an "already complete" (403135) error to a clear, non-retryable message', async () => {
    mocks.mockCancelFlowRun.mockRejectedValue(makeTableauError(403, '403135'));
    const result = await getToolResult({ flowRunId: FLOW_RUN_ID });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('already completed');
  });

  it('maps a "cancellation disabled" (403136) error to a clear message', async () => {
    mocks.mockCancelFlowRun.mockRejectedValue(makeTableauError(403, '403136'));
    const result = await getToolResult({ flowRunId: FLOW_RUN_ID });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('disabled for this site');
  });

  it('maps a permission (403137) error to a clear ownership/permission message', async () => {
    mocks.mockCancelFlowRun.mockRejectedValue(makeTableauError(403, '403137'));
    const result = await getToolResult({ flowRunId: FLOW_RUN_ID });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Not permitted to cancel this flow run');
    expect(result.content[0].text).toContain('initiated the run');
  });

  it('maps a 404 into a flow-run-not-found error', async () => {
    mocks.mockCancelFlowRun.mockRejectedValue(makeTableauError(404, '404036'));
    const result = await getToolResult({ flowRunId: FLOW_RUN_ID });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('flow run was not found');
  });
});

function makeTableauError(status: number, code: string): Error {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number; data: { error: { code: string; summary: string } } };
  };
  err.isAxiosError = true;
  err.response = { status, data: { error: { code, summary: 'Tableau error' } } };
  return err;
}

async function getToolResult(
  args: { flowRunId: string },
  overrides?: { boundedContext: { projectIds: Set<string> | null; tags: Set<string> | null } },
): Promise<CallToolResult> {
  const tool = getCancelFlowRunTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = getMockRequestHandlerExtra();
  if (overrides) {
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue({ boundedContext: overrides.boundedContext }) as never;
  }
  return await callback(args, extra);
}
