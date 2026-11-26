import { CallToolResult } from '@modelcontextprotocol/server';

import { RestApi } from '../../../../sdks/tableau/restApi.js';
import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { exportedForTesting as signedTokenTesting } from '../../_lib/signedTokenEvidence.js';
import { mutationTokenConfigFromEnv } from '../../_lib/signedTokenEvidence.mock.js';
import { WebTool } from '../../tool.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { mockRunFlowJob } from './mockRunFlowJob.js';
import { exportedForTesting, getRunFlowTool } from './runFlow.js';

const mocks = vi.hoisted(() => ({
  mockRunFlowNow: vi.fn(),
  mockGetFlowRuns: vi.fn(),
  mockIsFlowAllowed: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
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
        getFlowRuns: mocks.mockGetFlowRuns,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

vi.mock('../../../../config.js', () => ({
  getConfig: vi.fn(() => ({
    ...mutationTokenConfigFromEnv(),
    flowWriteToolsEnabled: true,
    productTelemetryEndpoint: 'https://test.com',
    server: 'https://test.tableau.com',
  })),
}));

const FLOW_ID = 'd00700fe-28a0-4ece-a7af-5543ddf38a82';
const ORIGINAL_REST_API_VERSION = RestApi.version;
const EXISTING_RUNS = [
  { id: 'run-b', flowId: FLOW_ID, status: 'Success' },
  { id: 'run-a', flowId: FLOW_ID, status: 'Failed' },
];

describe('runFlowTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    signedTokenTesting.reset();
    mocks.mockGetFlowRuns.mockResolvedValue(EXISTING_RUNS);
    RestApi.version = '3.24';
    vi.spyOn(RestApi, 'versionIsAtLeast').mockReturnValue(true);
    mocks.mockIsFlowAllowed.mockResolvedValue({ allowed: true });
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
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
    expect(tool.paramsSchema).toHaveProperty('confirm');
    expect(tool.paramsSchema).toHaveProperty('confirmationToken');
  });

  it('is a non-read-only, non-idempotent tool and is enabled when the flag is on', async () => {
    const tool = getRunFlowTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(false);
    const annotations = await Provider.from(tool.annotations);
    expect(annotations?.readOnlyHint).toBe(false);
    expect(annotations?.destructiveHint).toBe(true);
    expect(annotations?.idempotentHint).toBe(false);
  });

  it.each(
    [undefined, false, true].flatMap((writeEnv) =>
      [false, true].map((writeFlag) => ({ writeEnv, writeFlag })),
    ),
  )(
    'resolves write availability for write env=$writeEnv, write FF=$writeFlag',
    async ({ writeEnv, writeFlag }) => {
      const { getConfig } = await import('../../../../config.js');
      vi.mocked(getConfig).mockReturnValueOnce({
        flowWriteToolsEnabled: writeEnv,
      } as ReturnType<typeof getConfig>);
      mocks.mockIsFeatureEnabled.mockImplementation(
        async (featureName: string) => featureName === 'flow-write-tools' && writeFlag,
      );
      const tool = getRunFlowTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(!(writeEnv ?? writeFlag));
    },
  );

  it('previews without enqueueing and returns a confirmation token', async () => {
    const result = await getToolResult({ flowId: FLOW_ID, runMode: 'incremental' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = JSON.parse(result.content[0].text) as string;
    expect(text).toContain('Preview');
    expect(text).toContain('No flow run has been started');
    expect(text).toMatch(
      /confirmationToken: "v1\.[0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43}"/,
    );
    expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
  });

  it('enqueues a run after a matching preview and returns the async job plus a runStatus note', async () => {
    mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
    const confirmationToken = await previewRunFlow({ flowId: FLOW_ID, runMode: 'incremental' });
    const result = await getToolResult({
      flowId: FLOW_ID,
      runMode: 'incremental',
      confirm: true,
      confirmationToken,
    });
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
    const args = {
      flowId: FLOW_ID,
      outputStepIds: ['step-1'],
      parameterOverrides: [{ parameterId: 'p1', overrideValue: '2' }],
    };
    const confirmationToken = await previewRunFlow(args);
    await getToolResult({
      ...args,
      confirm: true,
      confirmationToken,
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

  it('hashes confirmation bindings so parameter override values are not stored in the nonce key', () => {
    const binding = exportedForTesting.createRunFlowBinding({
      flowId: FLOW_ID,
      parameterOverrides: [{ parameterId: 'connection-password', overrideValue: 'secret-value' }],
    });

    expect(binding).toMatch(/^[a-f0-9]{64}$/);
    expect(binding).not.toContain('secret-value');
    expect(binding).not.toBe(
      exportedForTesting.createRunFlowBinding({
        flowId: FLOW_ID,
        parameterOverrides: [
          { parameterId: 'connection-password', overrideValue: 'different-secret' },
        ],
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

  it('rejects confirmation without a matching preview', async () => {
    const result = await getToolResult({
      flowId: FLOW_ID,
      confirm: true,
      confirmationToken: 'bad-token',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('could not verify that a preview ran');
    expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
  });

  it('rejects a confirmation token when the run arguments change', async () => {
    const confirmationToken = await previewRunFlow({ flowId: FLOW_ID, runMode: 'full' });
    const result = await getToolResult({
      flowId: FLOW_ID,
      runMode: 'incremental',
      confirm: true,
      confirmationToken,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('could not verify that a preview ran');
    expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
  });

  it('accepts a confirmation token when array argument elements are reordered', async () => {
    mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
    const confirmationToken = await previewRunFlow({
      flowId: FLOW_ID,
      outputStepIds: ['step-2', 'step-1'],
      parameterOverrides: [
        { parameterId: 'p2', overrideValue: 'val2' },
        { parameterId: 'p1', overrideValue: 'val1' },
      ],
    });
    const result = await getToolResult({
      flowId: FLOW_ID,
      outputStepIds: ['step-1', 'step-2'],
      parameterOverrides: [
        { parameterId: 'p1', overrideValue: 'val1' },
        { parameterId: 'p2', overrideValue: 'val2' },
      ],
      confirm: true,
      confirmationToken,
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockRunFlowNow).toHaveBeenCalled();
  });

  it('redacts the confirmation token from invocation logging', async () => {
    const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
    const logAndExecuteSpy = vi.spyOn(WebTool.prototype, 'logAndExecute');

    await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });

    expect(logAndExecuteSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: expect.objectContaining({ confirmationToken: '<redacted>' }),
      }),
    );
  });

  describe('signed token with a flow-run pre-state', () => {
    const SECRET = 'run-flow-replica-secret-0123456789abcdef';

    it("reads the flow's newest runs on preview and on confirm", async () => {
      mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(mocks.mockGetFlowRuns).toHaveBeenCalledTimes(2);
      expect(mocks.mockGetFlowRuns).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        filter: `flowId:eq:${FLOW_ID}`,
        sort: 'completedAt:desc',
        pageSize: 10,
        pageNumber: 1,
      });
    });

    it('confirms on a second instance with the same MUTATION_TOKEN_SECRET', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', SECRET);
      signedTokenTesting.reset();
      mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      signedTokenTesting.reset(); // a new replica: fresh keys and replay cache, same secret
      const result = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(false);
      expect(mocks.mockRunFlowNow).toHaveBeenCalledOnce();
    });

    it('rejects a token minted under a different secret', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', SECRET);
      signedTokenTesting.reset();
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      vi.stubEnv('MUTATION_TOKEN_SECRET', 'a-completely-different-secret-0123456789');
      signedTokenTesting.reset();
      const result = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(true);
      expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
    });

    it('rejects a replay of a consumed token on the same instance', async () => {
      mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      const first = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(first.isError).toBe(false);
      const replay = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(replay.isError).toBe(true);
      expect(mocks.mockRunFlowNow).toHaveBeenCalledOnce();
    });

    it('rejects with the state-changed explanation when a new run appeared since the preview', async () => {
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      mocks.mockGetFlowRuns.mockResolvedValue([
        { id: 'run-c', flowId: FLOW_ID, status: 'Pending' },
        ...EXISTING_RUNS,
      ]);
      const result = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(signedTokenTesting.STATE_CHANGED_EXPLANATION);
      expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
    });

    // Live-probed: a never-run flow's Get Flow Runs returns an empty list, not a 404.
    it('previews and confirms a flow that has never run (empty run list on both phases)', async () => {
      mocks.mockGetFlowRuns.mockResolvedValue([]);
      mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      const result = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(false);
      expect(mocks.mockRunFlowNow).toHaveBeenCalledOnce();
    });

    it('rejects a never-run preview once the flow gained a run before the confirm', async () => {
      mocks.mockGetFlowRuns.mockResolvedValue([]);
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      mocks.mockGetFlowRuns.mockResolvedValue([
        { id: 'run-new', flowId: FLOW_ID, status: 'Pending' },
      ]);
      const result = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(true);
      expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
    });

    it('does not reject when an existing run only changed status since the preview', async () => {
      mocks.mockGetFlowRuns.mockResolvedValue([
        { id: 'run-c', flowId: FLOW_ID, status: 'Pending' },
        ...EXISTING_RUNS,
      ]);
      mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      mocks.mockGetFlowRuns.mockResolvedValue([
        { id: 'run-c', flowId: FLOW_ID, status: 'Success' },
        ...EXISTING_RUNS,
      ]);
      const result = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(false);
      expect(mocks.mockRunFlowNow).toHaveBeenCalledOnce();
    });

    it('does not reject when the same runs come back in a different order', async () => {
      mocks.mockRunFlowNow.mockResolvedValue(mockRunFlowJob);
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      mocks.mockGetFlowRuns.mockResolvedValue([...EXISTING_RUNS].reverse());
      const result = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(false);
    });

    it('fails closed on preview when the run lookup fails (no token minted)', async () => {
      mocks.mockGetFlowRuns.mockRejectedValue(new Error('lookup failed'));
      const result = await getToolResult({ flowId: FLOW_ID });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).not.toContain('confirmationToken: "v1.');
      expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
    });

    it('fails closed on confirm when the run lookup fails', async () => {
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      mocks.mockGetFlowRuns.mockRejectedValue(new Error('lookup failed'));
      const result = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(true);
      expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
    });

    // W-25002517: a token consented before run-flow required tableau:flow_runs:read is refused by
    // Tableau on the pre-state read. The error must name the scope and say to reconnect, not the
    // "not the flow owner / Prep Conductor" text mapFlowWriteError gives the run itself.
    it.each([401, 403])(
      'names tableau:flow_runs:read and says to reconnect when the preview run lookup is refused (%i)',
      async (status) => {
        mocks.mockGetFlowRuns.mockRejectedValue(makeAxiosError(status));
        const result = await getToolResult({ flowId: FLOW_ID });
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        const text = result.content[0].text;
        expect(text).toContain(
          "Could not read this flow's recent runs to prepare the confirmation (requires tableau:flow_runs:read)",
        );
        expect(text).toContain('Reconnect Tableau');
        expect(text).not.toContain('Not permitted to');
        expect(text).not.toContain('Prep Conductor');
        expect(text).not.toContain('confirmationToken: "v1.');
        expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
      },
    );

    it('names tableau:flow_runs:read on confirm when the run lookup is refused, and does not run', async () => {
      const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
      mocks.mockGetFlowRuns.mockRejectedValue(makeAxiosError(403));
      const result = await getToolResult({ flowId: FLOW_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('requires tableau:flow_runs:read');
      expect(result.content[0].text).toContain('Reconnect Tableau');
      expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
    });

    it('keeps the generic not-found mapping for a non-auth pre-state failure (404)', async () => {
      mocks.mockGetFlowRuns.mockRejectedValue(makeAxiosError(404));
      const result = await getToolResult({ flowId: FLOW_ID });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).not.toContain('tableau:flow_runs:read');
      expect(result.content[0].text).toContain('not found');
      expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
    });

    it('rejects when the parameter binding changes between preview and confirm', async () => {
      const confirmationToken = await previewRunFlow({
        flowId: FLOW_ID,
        parameterOverrides: [{ parameterId: 'p1', overrideValue: 'a' }],
      });
      const result = await getToolResult({
        flowId: FLOW_ID,
        parameterOverrides: [{ parameterId: 'p1', overrideValue: 'b' }],
        confirm: true,
        confirmationToken,
      });
      expect(result.isError).toBe(true);
      expect(mocks.mockRunFlowNow).not.toHaveBeenCalled();
    });
  });

  it('maps a 403 into a clear licensing/permission error after confirmation', async () => {
    const confirmationToken = await previewRunFlow({ flowId: FLOW_ID });
    mocks.mockRunFlowNow.mockRejectedValue(makeAxiosError(403));
    const result = await getToolResult({
      flowId: FLOW_ID,
      confirm: true,
      confirmationToken,
    });
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

type RunFlowArgs = {
  flowId: string;
  runMode?: 'full' | 'incremental';
  outputStepIds?: string[];
  parameterOverrides?: Array<{ parameterId: string; overrideValue: string }>;
  confirm?: boolean;
  confirmationToken?: string;
};

async function previewRunFlow(
  args: Omit<RunFlowArgs, 'confirm' | 'confirmationToken'>,
): Promise<string> {
  const result = await getToolResult(args);
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  const text = JSON.parse(result.content[0].text) as string;
  const match = text.match(
    /confirmationToken: "(v1\.[0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43})"/,
  );
  invariant(match, `expected a confirmation token in preview: ${text}`);
  return match[1];
}

async function getToolResult(args: RunFlowArgs): Promise<CallToolResult> {
  const tool = getRunFlowTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    {
      flowId: args.flowId,
      runMode: args.runMode,
      outputStepIds: args.outputStepIds,
      parameterOverrides: args.parameterOverrides,
      confirm: args.confirm,
      confirmationToken: args.confirmationToken,
    },
    getMockRequestHandlerExtra(),
  );
}
