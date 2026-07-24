import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { RestApi } from '../../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { WebTool } from '../../tool.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { mockRunFlowJob } from './mockRunFlowJob.js';
import { exportedForTesting, getRunFlowTool } from './runFlow.js';

const mocks = vi.hoisted(() => ({
  mockRunFlowNow: vi.fn(),
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
      flowsMethods: {
        runFlowNow: mocks.mockRunFlowNow,
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

const FLOW_ID = 'd00700fe-28a0-4ece-a7af-5543ddf38a82';
const ORIGINAL_REST_API_VERSION = RestApi.version;

describe('runFlowTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    RestApi.version = '3.24';
    vi.spyOn(RestApi, 'versionIsAtLeast').mockReturnValue(true);
    mocks.mockIsFlowAllowed.mockResolvedValue({ allowed: true });
  });

  afterAll(() => {
    vi.restoreAllMocks();
    RestApi.version = ORIGINAL_REST_API_VERSION;
  });

  it('creates a tool instance with correct properties', () => {
    const tool = getRunFlowTool(new WebMcpServer());
    expect(tool.name).toBe('run-flow');
    expect(tool.description).toContain('Runs a Tableau Prep flow');
    expect(tool.paramsSchema).toHaveProperty('flowId');
    expect(tool.paramsSchema).toHaveProperty('runMode');
    expect(tool.paramsSchema).toHaveProperty('outputStepIds');
    expect(tool.paramsSchema).toHaveProperty('parameterOverrides');
  });

  it('is a non-read-only, non-idempotent tool and is enabled when the flag is on', async () => {
    const tool = getRunFlowTool(new WebMcpServer());
    expect(tool.disabled).toBeFalsy();
    const annotations = await Provider.from(tool.annotations);
    expect(annotations?.readOnlyHint).toBe(false);
    expect(annotations?.destructiveHint).toBe(true);
    expect(annotations?.idempotentHint).toBe(false);
  });

  it('enqueues a run and returns the async job plus a runStatus note', async () => {
    mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
    const result = await getToolResult({ flowId: FLOW_ID, runMode: 'incremental' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.job).toEqual(mockRunFlowJob);
    expect(payload.mcp.runStatus).toContain('asynchronously');
    expect(mocks.mockRunFlowNow).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      flowId: FLOW_ID,
      runMode: 'incremental',
      outputStepIds: undefined,
      parameterSpecs: undefined,
    });
  });

  it('passes output steps and parameter overrides through to the SDK', async () => {
    mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
    await getToolResult({
      flowId: FLOW_ID,
      outputStepIds: ['step-1'],
      parameterOverrides: [{ parameterId: 'p1', overrideValue: '2' }],
    });
    expect(mocks.mockRunFlowNow).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      flowId: FLOW_ID,
      runMode: undefined,
      outputStepIds: ['step-1'],
      parameterSpecs: [{ parameterId: 'p1', overrideValue: '2' }],
    });
  });

  it('redacts parameter override values from invocation logging', async () => {
    mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
    const logAndExecuteSpy = vi.spyOn(WebTool.prototype, 'logAndExecute');

    await getToolResult({
      flowId: FLOW_ID,
      parameterOverrides: [{ parameterId: 'connection-password', overrideValue: 'secret-value' }],
    });

    expect(logAndExecuteSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        args: {
          flowId: FLOW_ID,
          runMode: undefined,
          outputStepIds: undefined,
          parameterOverrides: [{ parameterId: 'connection-password', overrideValue: '<redacted>' }],
        },
      }),
    );
  });

  it('rejects an explicit empty output-step selection', () => {
    const result = exportedForTesting.runFlowParamsSchema.outputStepIds.safeParse([]);
    expect(result.success).toBe(false);
  });

  it('refuses before checking bounded context on REST API versions that do not support the modern run spec body', async () => {
    vi.mocked(RestApi.versionIsAtLeast).mockReturnValue(false);
    const result = await getToolResult({ flowId: FLOW_ID, outputStepIds: ['step-1'] });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(RestApi.versionIsAtLeast).toHaveBeenCalledWith('3.14');
    expect(result.content[0].text).toContain('REST API version 3.14 or later');
    expect(result.content[0].text).toContain('silently ignoring run options');
    expect(mocks.mockIsFlowAllowed).not.toHaveBeenCalled();
    expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
  });

  it('refuses (fails closed) when the flow is outside the bounded context', async () => {
    mocks.mockIsFlowAllowed.mockResolvedValue({
      allowed: false,
      message: 'limited by the server configuration',
    });
    const result = await getToolResult({ flowId: FLOW_ID });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('limited by the server configuration');
    expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
  });

  it('maps a 403 into a clear licensing/permission error', async () => {
    mocks.mockRunFlowNow.mockRejectedValue(makeAxiosError(403));
    const result = await getToolResult({ flowId: FLOW_ID });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Not permitted to run this flow');
    expect(result.content[0].text).toContain('Data Management');
  });
});

function makeAxiosError(status: number): Error {
  const err = new Error(`Request failed with status code ${status}`) as Error & {
    isAxiosError: boolean;
    response: { status: number };
  };
  err.isAxiosError = true;
  err.response = { status };
  return err;
}

async function getToolResult(args: {
  flowId: string;
  runMode?: 'full' | 'incremental';
  outputStepIds?: string[];
  parameterOverrides?: Array<{ parameterId: string; overrideValue: string }>;
}): Promise<CallToolResult> {
  const tool = getRunFlowTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      flowId: args.flowId,
      runMode: args.runMode,
      outputStepIds: args.outputStepIds,
      parameterOverrides: args.parameterOverrides,
    },
    getMockRequestHandlerExtra(),
  );
}
