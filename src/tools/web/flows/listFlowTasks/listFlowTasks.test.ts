import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../../server.web.js';
import { stubDefaultEnvVars } from '../../../../testShared.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { constrainFlowTasks, getListFlowTasksTool } from './listFlowTasks.js';
import { mockFlowRunTasks } from './mockFlowRunTasks.js';

const mocks = vi.hoisted(() => ({
  mockGetFlowRunTasks: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      tasksMethods: {
        getFlowRunTasks: mocks.mockGetFlowRunTasks,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

const NO_BOUNDED_CONTEXT = {
  projectIds: null,
  datasourceIds: null,
  workbookIds: null,
  viewIds: null,
  tags: null,
} as const;

describe('listFlowTasksTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getListFlowTasksTool(new WebMcpServer());
    expect(tool.name).toBe('list-flow-tasks');
    expect(tool.description).toContain('scheduled flow run tasks');
    expect(tool.paramsSchema).toHaveProperty('filter');
    expect(tool.paramsSchema).toHaveProperty('pageSize');
    expect(tool.paramsSchema).toHaveProperty('limit');
  });

  it('is not admin-gated (callable without ADMIN_TOOLS_ENABLED)', () => {
    const tool = getListFlowTasksTool(new WebMcpServer());
    expect(tool.disabled).toBeFalsy();
  });

  it('successfully lists flow run tasks with a resultInfo signal', async () => {
    mocks.mockGetFlowRunTasks.mockResolvedValue(mockFlowRunTasks);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.flowTasks).toEqual(mockFlowRunTasks);
    expect(payload.mcp.resultInfo).toEqual({
      returnedCount: 2,
      truncated: false,
      totalAvailable: 2,
    });
    expect(mocks.mockGetFlowRunTasks).toHaveBeenCalledWith({ siteId: 'test-site-id' });
  });

  it('returns an empty message when no tasks are found', async () => {
    mocks.mockGetFlowRunTasks.mockResolvedValue([]);
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No flow run tasks were found');
  });

  it('handles API errors gracefully', async () => {
    mocks.mockGetFlowRunTasks.mockRejectedValue(new Error('Tasks boom'));
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Tasks boom');
  });

  it('filters client-side by flow.name', async () => {
    mocks.mockGetFlowRunTasks.mockResolvedValue(mockFlowRunTasks);
    const result = await getToolResult({ filter: 'flow.name:eq:allUseCaseTFLX2' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.flowTasks).toHaveLength(1);
    expect(payload.flowTasks[0].flow.name).toBe('allUseCaseTFLX2');
    expect(payload.mcp.resultInfo).toEqual({
      returnedCount: 1,
      truncated: false,
      totalAvailable: 1,
    });
  });

  it('filters client-side by schedule.state with the in operator', async () => {
    mocks.mockGetFlowRunTasks.mockResolvedValue(mockFlowRunTasks);
    const result = await getToolResult({ filter: 'schedule.state:in:Active|Suspended' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.flowTasks).toHaveLength(2);
  });

  it('rejects an unsupported filter field', async () => {
    await expect(getToolResult({ filter: 'bogus:eq:x' })).rejects.toThrow();
  });

  it('respects the limit parameter and reports requested-limit truncation', async () => {
    mocks.mockGetFlowRunTasks.mockResolvedValue(mockFlowRunTasks);
    const result = await getToolResult({ limit: 1 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.flowTasks).toHaveLength(1);
    expect(payload.mcp.resultInfo).toEqual({
      returnedCount: 1,
      truncated: true,
      truncationReason: 'requested-limit',
      totalAvailable: 2,
    });
  });

  it('honors an admin MAX_RESULT_LIMIT as a client-side cap and reports admin-cap', async () => {
    vi.stubEnv('MAX_RESULT_LIMITS', 'list-flow-tasks:1');
    try {
      mocks.mockGetFlowRunTasks.mockResolvedValue(mockFlowRunTasks);
      const result = await getToolResult({});
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.flowTasks).toHaveLength(1);
      expect(payload.mcp.resultInfo).toEqual({
        returnedCount: 1,
        truncated: true,
        truncationReason: 'admin-cap',
        totalAvailable: 2,
      });
    } finally {
      vi.unstubAllEnvs();
      stubDefaultEnvVars();
    }
  });

  describe('constrainFlowTasks', () => {
    it('returns empty when no tasks are found', () => {
      const result = constrainFlowTasks({
        result: { flowTasks: [] },
        boundedContext: NO_BOUNDED_CONTEXT,
      });
      invariant(result.type === 'empty');
      expect(result.message).toContain('No flow run tasks were found');
    });

    it('returns success and carries resultInfo through when no bounded context is configured', () => {
      const result = constrainFlowTasks({
        result: {
          flowTasks: mockFlowRunTasks,
          mcp: { resultInfo: { returnedCount: 2, truncated: false, totalAvailable: 2 } },
        },
        boundedContext: NO_BOUNDED_CONTEXT,
      });
      invariant(result.type === 'success');
      expect(result.result.flowTasks).toEqual(mockFlowRunTasks);
      expect(result.result.mcp.resultInfo).toEqual({
        returnedCount: 2,
        truncated: false,
        totalAvailable: 2,
      });
    });

    it('preserves the truncation signal through the success path', () => {
      const result = constrainFlowTasks({
        result: {
          flowTasks: [mockFlowRunTasks[0]],
          mcp: {
            resultInfo: {
              returnedCount: 1,
              truncated: true,
              truncationReason: 'requested-limit',
              totalAvailable: 2,
            },
          },
        },
        boundedContext: NO_BOUNDED_CONTEXT,
      });
      invariant(result.type === 'success');
      expect(result.result.mcp.resultInfo).toEqual({
        returnedCount: 1,
        truncated: true,
        truncationReason: 'requested-limit',
        totalAvailable: 2,
      });
    });

    it.each([
      ['projectIds', { ...NO_BOUNDED_CONTEXT, projectIds: new Set(['p1']) }],
      ['tags', { ...NO_BOUNDED_CONTEXT, tags: new Set(['t1']) }],
    ])('fails closed under a %s bounded context', (_label, boundedContext) => {
      const result = constrainFlowTasks({
        result: { flowTasks: mockFlowRunTasks },
        boundedContext: boundedContext as Parameters<
          typeof constrainFlowTasks
        >[0]['boundedContext'],
      });
      invariant(result.type === 'empty');
      expect(result.message).toContain('limited by the server configuration');
    });
  });
});

async function getToolResult(args: {
  filter?: string;
  pageSize?: number;
  limit?: number;
}): Promise<CallToolResult> {
  const tool = getListFlowTasksTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { filter: args.filter, pageSize: args.pageSize, limit: args.limit },
    getMockRequestHandlerExtra(),
  );
}
