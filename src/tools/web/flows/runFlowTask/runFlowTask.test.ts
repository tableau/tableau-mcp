import { CallToolResult } from '@modelcontextprotocol/server';

import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { exportedForTesting as signedTokenTesting } from '../../_lib/signedTokenEvidence.js';
import { mutationTokenConfigFromEnv } from '../../_lib/signedTokenEvidence.mock.js';
import { WebTool } from '../../tool.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { mockRunFlowJob } from '../runFlow/mockRunFlowJob.js';
import { getRunFlowTaskTool } from './runFlowTask.js';

const mocks = vi.hoisted(() => ({
  mockRunFlowTask: vi.fn(),
  mockGetFlowRunTask: vi.fn(),
  mockGetFlowRuns: vi.fn(),
  mockIsFeatureEnabled: vi.fn(),
}));

vi.mock('../../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.mockIsFeatureEnabled })),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      tasksMethods: {
        runFlowTask: mocks.mockRunFlowTask,
        getFlowRunTask: mocks.mockGetFlowRunTask,
      },
      flowsMethods: {
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

const TASK_ID = '1bff10bb-57ae-43df-8774-a86d14aef432';
const FLOW_ID = 'd00700fe-28a0-4ece-a7af-5543ddf38a82';
const EXISTING_RUNS = [{ id: 'run-a', flowId: FLOW_ID, status: 'Success' }];

describe('runFlowTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    signedTokenTesting.reset();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
    mocks.mockGetFlowRunTask.mockResolvedValue({ id: TASK_ID, flow: { id: FLOW_ID } });
    mocks.mockGetFlowRuns.mockResolvedValue(EXISTING_RUNS);
  });

  it('creates a tool instance with correct properties', async () => {
    const tool = getRunFlowTaskTool(new WebMcpServer());
    expect(tool.name).toBe('run-flow-task');
    expect(tool.description).toContain('existing scheduled flow run task');
    expect(tool.paramsSchema).toHaveProperty('taskId');
    expect(tool.paramsSchema).toHaveProperty('confirm');
    expect(tool.paramsSchema).toHaveProperty('confirmationToken');
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
      const tool = getRunFlowTaskTool(new WebMcpServer());
      expect(await Provider.from(tool.disabled)).toBe(!(writeEnv ?? writeFlag));
    },
  );

  it('previews without enqueueing and returns a confirmation token', async () => {
    const result = await getToolResult({ taskId: TASK_ID });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = JSON.parse(result.content[0].text) as string;
    expect(text).toContain('Preview');
    expect(text).toContain('No flow run has been started');
    expect(text).toMatch(
      /confirmationToken: "v1\.[0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43}"/,
    );
    expect(mocks.mockRunFlowTask).not.toHaveBeenCalled();
  });

  it('runs an existing task after a matching preview and returns the async job', async () => {
    mocks.mockRunFlowTask.mockResolvedValue(mockRunFlowJob);
    const confirmationToken = await previewRunFlowTask();
    const result = await getToolResult({
      taskId: TASK_ID,
      confirm: true,
      confirmationToken,
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.job).toEqual(mockRunFlowJob);
    expect(payload.mcp.runStatus).toContain('asynchronously');
    expect(mocks.mockRunFlowTask).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      taskId: TASK_ID,
    });
  });

  it('rejects a run without a matching preview', async () => {
    const result = await getToolResult({
      taskId: TASK_ID,
      confirm: true,
      confirmationToken: 'bad-token',
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('could not verify that a preview ran');
    expect(mocks.mockRunFlowTask).not.toHaveBeenCalled();
  });

  it('redacts the confirmation token from invocation logging', async () => {
    const confirmationToken = await previewRunFlowTask();
    const logAndExecuteSpy = vi.spyOn(WebTool.prototype, 'logAndExecute');

    await getToolResult({
      taskId: TASK_ID,
      confirm: true,
      confirmationToken,
    });

    expect(logAndExecuteSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: { taskId: TASK_ID, confirm: true, confirmationToken: '<redacted>' },
      }),
    );
  });

  it('fails closed under a bounded context (cannot prove the task is in scope)', async () => {
    const result = await getToolResult(
      { taskId: TASK_ID },
      { boundedContext: { projectIds: new Set(['p1']), tags: null } },
    );
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('restricted to an allowed set');
    expect(mocks.mockRunFlowTask).not.toHaveBeenCalled();
  });

  describe("signed token with the task flow's run pre-state", () => {
    const SECRET = 'run-flow-task-replica-secret-0123456789ab';

    it("resolves the task's flow, then reads that flow's newest runs, on both phases", async () => {
      mocks.mockRunFlowTask.mockResolvedValue(mockRunFlowJob);
      const confirmationToken = await previewRunFlowTask();
      await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
      expect(mocks.mockGetFlowRunTask).toHaveBeenCalledTimes(2);
      expect(mocks.mockGetFlowRunTask).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        taskId: TASK_ID,
      });
      expect(mocks.mockGetFlowRuns).toHaveBeenCalledTimes(2);
      expect(mocks.mockGetFlowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ filter: `flowId:eq:${FLOW_ID}` }),
      );
    });

    it('confirms on a second instance with the same MUTATION_TOKEN_SECRET', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', SECRET);
      signedTokenTesting.reset();
      mocks.mockRunFlowTask.mockResolvedValue(mockRunFlowJob);
      const confirmationToken = await previewRunFlowTask();
      signedTokenTesting.reset();
      const result = await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(false);
      expect(mocks.mockRunFlowTask).toHaveBeenCalledOnce();
    });

    it('rejects a token minted under a different secret', async () => {
      vi.stubEnv('MUTATION_TOKEN_SECRET', SECRET);
      signedTokenTesting.reset();
      const confirmationToken = await previewRunFlowTask();
      vi.stubEnv('MUTATION_TOKEN_SECRET', 'a-completely-different-secret-0123456789');
      signedTokenTesting.reset();
      mocks.mockGetFlowRunTask.mockClear();
      mocks.mockGetFlowRuns.mockClear();
      const result = await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(true);
      expect(mocks.mockRunFlowTask).not.toHaveBeenCalled();
      // The MAC is checked before the pre-state reads: a forged token costs no REST call.
      expect(mocks.mockGetFlowRunTask).not.toHaveBeenCalled();
      expect(mocks.mockGetFlowRuns).not.toHaveBeenCalled();
    });

    it('rejects a replay of a consumed token on the same instance', async () => {
      mocks.mockRunFlowTask.mockResolvedValue(mockRunFlowJob);
      const confirmationToken = await previewRunFlowTask();
      expect(
        (await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken })).isError,
      ).toBe(false);
      const replay = await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
      expect(replay.isError).toBe(true);
      expect(mocks.mockRunFlowTask).toHaveBeenCalledOnce();
    });

    it('rejects with the state-changed explanation when a new run appeared since the preview', async () => {
      const confirmationToken = await previewRunFlowTask();
      mocks.mockGetFlowRuns.mockResolvedValue([
        { id: 'run-new', flowId: FLOW_ID, status: 'InProgress' },
        ...EXISTING_RUNS,
      ]);
      const result = await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain(signedTokenTesting.STATE_CHANGED_EXPLANATION);
      expect(mocks.mockRunFlowTask).not.toHaveBeenCalled();
    });

    it('does not reject when an existing run only changed status since the preview', async () => {
      mocks.mockGetFlowRuns.mockResolvedValue([
        { id: 'run-a', flowId: FLOW_ID, status: 'Pending' },
      ]);
      mocks.mockRunFlowTask.mockResolvedValue(mockRunFlowJob);
      const confirmationToken = await previewRunFlowTask();
      mocks.mockGetFlowRuns.mockResolvedValue([
        { id: 'run-a', flowId: FLOW_ID, status: 'InProgress' },
      ]);
      const result = await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(false);
      expect(mocks.mockRunFlowTask).toHaveBeenCalledOnce();
    });

    it('fails closed on preview when the task lookup fails (no token minted)', async () => {
      mocks.mockGetFlowRunTask.mockRejectedValue(new Error('lookup failed'));
      const result = await getToolResult({ taskId: TASK_ID });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).not.toContain('confirmationToken: "v1.');
    });

    it('fails closed when the task has no resolvable flow', async () => {
      mocks.mockGetFlowRunTask.mockResolvedValue({ id: TASK_ID });
      const result = await getToolResult({ taskId: TASK_ID });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Could not resolve the flow');
      expect(mocks.mockGetFlowRuns).not.toHaveBeenCalled();
    });

    it('fails closed on confirm when the run lookup fails', async () => {
      const confirmationToken = await previewRunFlowTask();
      mocks.mockGetFlowRuns.mockRejectedValue(new Error('lookup failed'));
      const result = await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(true);
      expect(mocks.mockRunFlowTask).not.toHaveBeenCalled();
    });

    // W-25002517: pre-state reads refused for a token consented before the scopes were required.
    it.each([401, 403])(
      'names tableau:flow_tasks:read (and flow_runs:read) when the task lookup is refused (%i)',
      async (status) => {
        mocks.mockGetFlowRunTask.mockRejectedValue(makeAxiosError(status));
        const result = await getToolResult({ taskId: TASK_ID });
        expect(result.isError).toBe(true);
        invariant(result.content[0].type === 'text');
        const text = result.content[0].text;
        expect(text).toContain(
          'to prepare the confirmation (requires tableau:flow_tasks:read and tableau:flow_runs:read)',
        );
        expect(text).toContain('Reconnect Tableau');
        expect(text).not.toContain('Not permitted to');
        expect(text).not.toContain('confirmationToken: "v1.');
        expect(mocks.mockGetFlowRuns).not.toHaveBeenCalled();
        expect(mocks.mockRunFlowTask).not.toHaveBeenCalled();
      },
    );

    it('names tableau:flow_runs:read when the run lookup is refused on preview', async () => {
      mocks.mockGetFlowRuns.mockRejectedValue(makeAxiosError(403));
      const result = await getToolResult({ taskId: TASK_ID });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      const text = result.content[0].text;
      expect(text).toContain('(requires tableau:flow_runs:read)');
      expect(text).not.toContain('tableau:flow_tasks:read');
      expect(text).toContain('Reconnect Tableau');
      expect(mocks.mockRunFlowTask).not.toHaveBeenCalled();
    });

    it('names the scope on confirm when the run lookup is refused, and does not run', async () => {
      const confirmationToken = await previewRunFlowTask();
      mocks.mockGetFlowRuns.mockRejectedValue(makeAxiosError(401));
      const result = await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('requires tableau:flow_runs:read');
      expect(mocks.mockRunFlowTask).not.toHaveBeenCalled();
    });

    it('rejects a token previewed for a different task (binding change)', async () => {
      const confirmationToken = await previewRunFlowTask();
      const result = await getToolResult({
        taskId: '11111111-2222-4333-8444-555555555555',
        confirm: true,
        confirmationToken,
      });
      expect(result.isError).toBe(true);
      expect(mocks.mockRunFlowTask).not.toHaveBeenCalled();
    });
  });

  it('releases the token on a definite 4xx from Run Flow Task: a retry with the same token runs', async () => {
    const confirmationToken = await previewRunFlowTask();
    mocks.mockRunFlowTask.mockRejectedValueOnce(makeAxiosError(403));
    const first = await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
    expect(first.isError).toBe(true);
    mocks.mockRunFlowTask.mockResolvedValue(mockRunFlowJob);
    const retry = await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
    expect(retry.isError).toBe(false);
    expect(mocks.mockRunFlowTask).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a 5xx', makeAxiosError(502)],
    ['a network error', new Error('socket hang up')],
  ])('keeps the token consumed on %s from Run Flow Task (outcome unknown)', async (_l, error) => {
    const confirmationToken = await previewRunFlowTask();
    mocks.mockRunFlowTask.mockRejectedValueOnce(error);
    expect(
      (await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken })).isError,
    ).toBe(true);
    mocks.mockRunFlowTask.mockResolvedValue(mockRunFlowJob);
    const retry = await getToolResult({ taskId: TASK_ID, confirm: true, confirmationToken });
    expect(retry.isError).toBe(true);
    expect(mocks.mockRunFlowTask).toHaveBeenCalledOnce();
  });

  it('maps a 403 into a clear licensing/permission error after confirmation', async () => {
    const confirmationToken = await previewRunFlowTask();
    mocks.mockRunFlowTask.mockRejectedValue(makeAxiosError(403));
    const result = await getToolResult({
      taskId: TASK_ID,
      confirm: true,
      confirmationToken,
    });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Not permitted to run this flow task');
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

type RunFlowTaskArgs = {
  taskId: string;
  confirm?: boolean;
  confirmationToken?: string;
};

async function previewRunFlowTask(): Promise<string> {
  const result = await getToolResult({ taskId: TASK_ID });
  expect(result.isError).toBe(false);
  invariant(result.content[0].type === 'text');
  const text = JSON.parse(result.content[0].text) as string;
  const match = text.match(
    /confirmationToken: "(v1\.[0-9]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{11}\.[A-Za-z0-9_-]{43})"/,
  );
  invariant(match, `expected a confirmation token in preview: ${text}`);
  return match[1];
}

async function getToolResult(
  args: RunFlowTaskArgs,
  overrides?: { boundedContext: { projectIds: Set<string> | null; tags: Set<string> | null } },
): Promise<CallToolResult> {
  const tool = getRunFlowTaskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = getMockRequestHandlerExtra();
  if (overrides) {
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue({ boundedContext: overrides.boundedContext }) as never;
  }
  return await callback(
    {
      taskId: args.taskId,
      confirm: args.confirm,
      confirmationToken: args.confirmationToken,
    },
    extra,
  );
}
