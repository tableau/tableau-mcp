import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { WebTool } from '../../tool.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { mockRunFlowJob } from '../runFlow/mockRunFlowJob.js';
import { getRunFlowTaskTool } from './runFlowTask.js';

const mocks = vi.hoisted(() => ({
  mockRunFlowTask: vi.fn(),
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

const TASK_ID = '1bff10bb-57ae-43df-8774-a86d14aef432';

describe('runFlowTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsFeatureEnabled.mockResolvedValue(true);
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

  it('is disabled when the flow-tools feature flag is off', async () => {
    mocks.mockIsFeatureEnabled.mockResolvedValue(false);
    const tool = getRunFlowTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('previews without enqueueing and returns a confirmation token', async () => {
    const result = await getToolResult({ taskId: TASK_ID });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const text = JSON.parse(result.content[0].text) as string;
    expect(text).toContain('Preview');
    expect(text).toContain('No flow run has been started');
    expect(text).toMatch(/confirmationToken: "[0-9a-f-]+"/);
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
  const match = text.match(/confirmationToken: "([0-9a-f-]+)"/);
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
