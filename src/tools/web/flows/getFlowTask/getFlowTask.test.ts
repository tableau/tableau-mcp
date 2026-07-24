import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { FlowRunTask } from '../../../../sdks/tableau/types/flowRunTask.js';
import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getGetFlowTaskTool } from './getFlowTask.js';

const mocks = vi.hoisted(() => ({
  mockGetFlowRunTask: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      tasksMethods: {
        getFlowRunTask: mocks.mockGetFlowRunTask,
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

const TASK_ID = '1bff10bb-57ae-43df-8774-a86d14aef432';
const mockTask: FlowRunTask = {
  id: TASK_ID,
  type: 'RunFlowTask',
  flow: { id: 'flow-1', name: 'Daily Sales' },
  schedule: { name: 'Daily', frequency: 'Daily', state: 'Active' },
};

describe('getFlowTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a read-only tool instance with correct properties', async () => {
    const tool = getGetFlowTaskTool(new WebMcpServer());
    expect(tool.name).toBe('get-flow-task');
    expect(tool.description).toContain('single scheduled flow run task');
    expect(tool.paramsSchema).toHaveProperty('taskId');
    const annotations = await Provider.from(tool.annotations);
    expect(annotations?.readOnlyHint).toBe(true);
    // Read tool: must NOT be gated by the write flag.
    expect(tool.disabled).toBeFalsy();
  });

  it('is disabled when flow tools are not enabled', async () => {
    const { getConfig } = await import('../../../../config.js');
    vi.mocked(getConfig).mockReturnValueOnce({
      flowToolsEnabled: false,
    } as ReturnType<typeof getConfig>);

    const tool = getGetFlowTaskTool(new WebMcpServer());
    expect(await Provider.from(tool.disabled)).toBe(true);
  });

  it('returns the flow task by id', async () => {
    mocks.mockGetFlowRunTask.mockResolvedValue(mockTask);
    const result = await getToolResult({ taskId: TASK_ID });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.flowTask).toEqual(mockTask);
    expect(mocks.mockGetFlowRunTask).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      taskId: TASK_ID,
    });
  });

  it('maps a 404 into a clear task-not-found error', async () => {
    mocks.mockGetFlowRunTask.mockRejectedValue(makeAxiosError(404));
    const result = await getToolResult({ taskId: TASK_ID });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Could not find this flow task');
    expect(result.content[0].text).toContain('list-flow-tasks');
  });

  it('maps a 403 into a clear ownership/permission error', async () => {
    mocks.mockGetFlowRunTask.mockRejectedValue(makeAxiosError(403));
    const result = await getToolResult({ taskId: TASK_ID });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Not permitted to read this flow task');
    expect(result.content[0].text).toContain('flows they own');
  });

  it('fails closed under a bounded context (cannot prove the task is in scope)', async () => {
    const result = await getToolResult(
      { taskId: TASK_ID },
      { boundedContext: { projectIds: new Set(['p1']), tags: null } },
    );
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('restricted to an allowed set');
    expect(mocks.mockGetFlowRunTask).not.toHaveBeenCalled();
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

async function getToolResult(
  args: { taskId: string },
  overrides?: { boundedContext: { projectIds: Set<string> | null; tags: Set<string> | null } },
): Promise<CallToolResult> {
  const tool = getGetFlowTaskTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  const extra = getMockRequestHandlerExtra();
  if (overrides) {
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue({ boundedContext: overrides.boundedContext }) as never;
  }
  return await callback(args, extra);
}
