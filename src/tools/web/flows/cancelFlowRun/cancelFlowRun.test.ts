import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { getConfig } from '../../../../config.js';
import { RestApi } from '../../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { WebTool } from '../../tool.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getCancelFlowRunTool } from './cancelFlowRun.js';

const mocks = vi.hoisted(() => ({
  mockCancelFlowRun: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
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
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
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
    expect(tool.paramsSchema).toHaveProperty('confirm');
    expect(tool.paramsSchema).toHaveProperty('confirmationToken');
    const annotations = await Provider.from(tool.annotations);
    expect(annotations?.readOnlyHint).toBe(false);
    expect(annotations?.destructiveHint).toBe(true);
    expect(annotations?.idempotentHint).toBe(false);
  });

  it('is enabled when the flow write flag is on', async () => {
    const tool = getCancelFlowRunTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(false);
  });

  it('is disabled when the flow-tools feature flag is off', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const tool = getCancelFlowRunTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('is disabled when the flow write flag is off (state-mutating tool is opt-in)', async () => {
    vi.mocked(getConfig).mockReturnValueOnce({
      flowToolsEnabled: true,
      flowWriteToolsEnabled: false,
      productTelemetryEnabled: false,
      productTelemetryEndpoint: 'https://test.com',
      server: 'https://test.tableau.com',
    } as unknown as ReturnType<typeof getConfig>);
    const tool = getCancelFlowRunTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('previews without requesting cancellation and returns a confirmation token', async () => {
    const result = await getToolResult({ flowRunId: FLOW_RUN_ID });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = JSON.parse(result.content[0].text) as string;
    expect(text).toContain('Preview');
    expect(text).toContain('No cancellation has been requested');
    expect(text).toMatch(/confirmationToken: "[0-9a-f-]+"/);
    expect(mocks.mockCancelFlowRun).not.toHaveBeenCalled();
  });

  it('requests cancellation after a matching preview', async () => {
    mocks.mockCancelFlowRun.mockResolvedValue(undefined);
    const confirmationToken = await previewCancelFlowRun();
    const result = await getToolResult({
      flowRunId: FLOW_RUN_ID,
      confirm: true,
      confirmationToken,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.mcp.cancelStatus).toContain('may still finish as Completed or Failed');
    expect(mocks.mockCancelFlowRun).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      flowRunId: FLOW_RUN_ID,
    });
  });

  it('rejects cancellation without a matching preview', async () => {
    const result = await getToolResult({
      flowRunId: FLOW_RUN_ID,
      confirm: true,
      confirmationToken: 'bad-token',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('could not verify that a preview ran');
    expect(mocks.mockCancelFlowRun).not.toHaveBeenCalled();
  });

  it('redacts the confirmation token from invocation logging', async () => {
    const confirmationToken = await previewCancelFlowRun();
    const logAndExecuteSpy = vi.spyOn(WebTool.prototype, 'logAndExecute');

    await getToolResult({
      flowRunId: FLOW_RUN_ID,
      confirm: true,
      confirmationToken,
    });

    expect(logAndExecuteSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: { flowRunId: FLOW_RUN_ID, confirm: true, confirmationToken: '<redacted>' },
      }),
    );
  });

  it('refuses on Tableau REST API versions before 3.10', async () => {
    vi.mocked(RestApi.versionIsAtLeast).mockReturnValue(false);

    const result = await getToolResult({ flowRunId: FLOW_RUN_ID });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('REST API version 3.10 or later');
    expect(mocks.mockCancelFlowRun).not.toHaveBeenCalled();
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
    const confirmationToken = await previewCancelFlowRun();
    mocks.mockCancelFlowRun.mockRejectedValue(makeTableauError(403, '403135'));
    const result = await getToolResult({
      flowRunId: FLOW_RUN_ID,
      confirm: true,
      confirmationToken,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('already completed');
  });

  it('maps a "cancellation disabled" (403136) error to a clear message', async () => {
    const confirmationToken = await previewCancelFlowRun();
    mocks.mockCancelFlowRun.mockRejectedValue(makeTableauError(403, '403136'));
    const result = await getToolResult({
      flowRunId: FLOW_RUN_ID,
      confirm: true,
      confirmationToken,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('disabled for this site');
  });

  it('maps a permission (403137) error to a clear ownership/permission message', async () => {
    const confirmationToken = await previewCancelFlowRun();
    mocks.mockCancelFlowRun.mockRejectedValue(makeTableauError(403, '403137'));
    const result = await getToolResult({
      flowRunId: FLOW_RUN_ID,
      confirm: true,
      confirmationToken,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Not permitted to cancel this flow run');
    expect(result.content[0].text).toContain('initiated the run');
  });

  it('maps a 404 into a flow-run-not-found error', async () => {
    const confirmationToken = await previewCancelFlowRun();
    mocks.mockCancelFlowRun.mockRejectedValue(makeTableauError(404, '404036'));
    const result = await getToolResult({
      flowRunId: FLOW_RUN_ID,
      confirm: true,
      confirmationToken,
    });
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

type CancelFlowRunArgs = {
  flowRunId: string;
  confirm?: boolean;
  confirmationToken?: string;
};

async function previewCancelFlowRun(): Promise<string> {
  const result = await getToolResult({ flowRunId: FLOW_RUN_ID });
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  const text = JSON.parse(result.content[0].text) as string;
  const match = text.match(/confirmationToken: "([0-9a-f-]+)"/);
  invariant(match, `expected a confirmation token in preview: ${text}`);
  return match[1];
}

async function getToolResult(
  args: CancelFlowRunArgs,
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
  return await callback(
    {
      flowRunId: args.flowRunId,
      confirm: args.confirm,
      confirmationToken: args.confirmationToken,
    },
    extra,
  );
}
