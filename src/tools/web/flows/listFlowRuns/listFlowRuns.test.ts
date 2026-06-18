import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { FlowRun } from '../../../../sdks/tableau/types/flow.js';
import { WebMcpServer } from '../../../../server.web.js';
import { stubDefaultEnvVars } from '../../../../testShared.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { constrainFlowRuns, getListFlowRunsTool } from './listFlowRuns.js';
import { mockFlowRuns } from './mockFlowRuns.js';

const mocks = vi.hoisted(() => ({
  mockGetFlowRuns: vi.fn(),
  mockQueryFlow: vi.fn(),
  mockVersionIsAtLeast: vi.fn((_version: `${number}.${number}`): boolean => true),
}));

vi.mock('../../../../sdks/tableau/restApi.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../sdks/tableau/restApi.js')>(
    '../../../../sdks/tableau/restApi.js',
  );
  return {
    ...actual,
    RestApi: {
      ...actual.RestApi,
      versionIsAtLeast: (version: `${number}.${number}`) => mocks.mockVersionIsAtLeast(version),
    },
  };
});

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      flowsMethods: {
        getFlowRuns: mocks.mockGetFlowRuns,
        queryFlow: mocks.mockQueryFlow,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

const FLOW_ID = 'd00700fe-28a0-4ece-a7af-5543ddf38a82';

function buildRuns(count: number, status = 'Success', startIndex = 0): FlowRun[] {
  return Array.from({ length: count }, (_, i) => {
    const n = startIndex + i;
    return {
      id: `run-${n.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      flowId: FLOW_ID,
      status: status as FlowRun['status'],
      startedAt: `2025-01-${String((n % 28) + 1).padStart(2, '0')}T10:00:00Z`,
      progress: 100,
    };
  });
}

const NO_BOUNDED_CONTEXT = {
  projectIds: null,
  datasourceIds: null,
  workbookIds: null,
  viewIds: null,
  tags: null,
} as const;

const FLOW_WEBPAGE_URL = 'https://my.tableau.example.com/#/site/mysite/flows/96151';

describe('listFlowRunsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockVersionIsAtLeast.mockReturnValue(true);
    // Default: the failure-insight resolver finds a flow with a webpageUrl.
    mocks.mockQueryFlow.mockResolvedValue({
      flow: { id: FLOW_ID, name: 'Daily Flow', webpageUrl: FLOW_WEBPAGE_URL },
      outputSteps: [],
    });
  });

  it('should create a tool instance with correct properties', () => {
    const tool = getListFlowRunsTool(new WebMcpServer());
    expect(tool.name).toBe('list-flow-runs');
    expect(tool.description).toContain('run history');
    expect(tool.paramsSchema).toMatchObject({ filter: expect.any(Object) });
  });

  it('lists flow runs with the default completedAt:desc sort and the server filter', async () => {
    mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);
    const result = await getToolResult({ filter: `flowId:eq:${FLOW_ID}` });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.flowRuns).toHaveLength(mockFlowRuns.length);
    expect(payload.mcp.resultInfo).toEqual({
      returnedCount: mockFlowRuns.length,
      truncated: false,
    });
    // Default sort is completedAt:desc — startedAt:desc floats every never-started
    // run (e.g. Cancelled-before-start) to the front and returns stale results.
    expect(mocks.mockGetFlowRuns).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: `flowId:eq:${FLOW_ID}`,
      sort: 'completedAt:desc',
      pageSize: 100,
      pageNumber: 1,
    });
  });

  it('orders the default result newest-first by completedAt, falling back to startedAt, nulls last', async () => {
    // Server returns rows in the endpoint's empty-key-first order (the anomalous
    // no-completedAt Success up top, Pending with neither timestamp mixed in).
    const scrambled: FlowRun[] = [
      // anomalous: only startedAt, dated long ago → should sink below today's runs
      { id: 'd0000000-0000-0000-0000-000000000000', status: 'Success', startedAt: '2025-09-27T17:45:19Z', progress: 100 },
      // Pending: neither timestamp → sorts LAST
      { id: 'e0000000-0000-0000-0000-000000000000', status: 'Pending', progress: 0 },
      // completed today (older of the two completions)
      { id: 'a0000000-0000-0000-0000-000000000000', status: 'Success', startedAt: '2026-06-11T18:54:04Z', completedAt: '2026-06-11T18:54:17Z', progress: 100 },
      // InProgress: startedAt is the newest activity of all → sorts FIRST
      { id: 'c0000000-0000-0000-0000-000000000000', status: 'InProgress', startedAt: '2026-06-11T19:30:00Z', progress: 42 },
      // most recently completed
      { id: 'b0000000-0000-0000-0000-000000000000', status: 'Cancelled', completedAt: '2026-06-11T19:01:10Z', progress: 100 },
    ];
    mocks.mockGetFlowRuns.mockResolvedValue(scrambled);

    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);

    expect(payload.flowRuns.map((r: FlowRun) => r.id)).toEqual([
      'c0000000-0000-0000-0000-000000000000', // 2026-06-11 19:30 (startedAt, InProgress)
      'b0000000-0000-0000-0000-000000000000', // 2026-06-11 19:01 (completedAt)
      'a0000000-0000-0000-0000-000000000000', // 2026-06-11 18:54 (completedAt)
      'd0000000-0000-0000-0000-000000000000', // 2025-09-27 (startedAt only)
      'e0000000-0000-0000-0000-000000000000', // Pending — neither timestamp, last
    ]);
  });

  it('preserves server order (no recency re-sort) when an explicit sort is supplied', async () => {
    const serverOrder: FlowRun[] = [
      { id: 'd0000000-0000-0000-0000-000000000000', status: 'Success', startedAt: '2025-09-27T17:45:19Z', progress: 100 },
      { id: 'b0000000-0000-0000-0000-000000000000', status: 'Cancelled', completedAt: '2026-06-11T19:01:10Z', progress: 100 },
      { id: 'a0000000-0000-0000-0000-000000000000', status: 'Success', startedAt: '2026-06-11T18:54:04Z', completedAt: '2026-06-11T18:54:17Z', progress: 100 },
    ];
    mocks.mockGetFlowRuns.mockResolvedValue(serverOrder);

    const result = await getToolResult({ sort: 'startedAt:asc' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);

    // Explicit sort is honored as-is: the tool must NOT re-order client-side.
    expect(payload.flowRuns.map((r: FlowRun) => r.id)).toEqual(serverOrder.map((r) => r.id));
    expect(mocks.mockGetFlowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'startedAt:asc' }),
    );
  });

  it('passes a caller-supplied sort through to the API', async () => {
    mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);
    await getToolResult({ sort: 'completedAt:asc' });
    expect(mocks.mockGetFlowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ sort: 'completedAt:asc' }),
    );
  });

  it('applies the status filter client-side and strips it from the server filter', async () => {
    mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);
    const result = await getToolResult({ filter: `flowId:eq:${FLOW_ID},status:eq:Failed` });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);

    expect(payload.flowRuns).toHaveLength(1);
    expect(payload.flowRuns[0].status).toBe('Failed');
    // status must NOT be sent to the server (it isn't a server-side filter field).
    expect(mocks.mockGetFlowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ filter: `flowId:eq:${FLOW_ID}` }),
    );
  });

  it('supports status:in:[...] client-side', async () => {
    mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);
    const result = await getToolResult({ filter: 'status:in:[Failed,InProgress]' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.flowRuns.map((r: FlowRun) => r.status).sort()).toEqual(['Failed', 'InProgress']);
    expect(mocks.mockGetFlowRuns).toHaveBeenCalledWith(expect.objectContaining({ filter: '' }));
  });

  it('rejects an unknown status value with the allowed list', async () => {
    await expect(getToolResult({ filter: 'status:eq:Borked' })).rejects.toThrow(/Allowed flow-run/);
  });

  it('rejects an unsupported filter field', async () => {
    await expect(getToolResult({ filter: 'bogusField:eq:x' })).rejects.toThrow();
  });

  it('reports requested-limit truncation when the caller limit cuts the result', async () => {
    mocks.mockGetFlowRuns.mockResolvedValue(buildRuns(3));
    const result = await getToolResult({ limit: 2 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.flowRuns).toHaveLength(2);
    expect(payload.mcp.resultInfo).toEqual({
      returnedCount: 2,
      truncated: true,
      truncationReason: 'requested-limit',
    });
  });

  it('reports admin-cap truncation when MAX_RESULT_LIMITS caps the result', async () => {
    vi.stubEnv('MAX_RESULT_LIMITS', 'list-flow-runs:1');
    try {
      mocks.mockGetFlowRuns.mockResolvedValue(buildRuns(3));
      const result = await getToolResult({});
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.flowRuns).toHaveLength(1);
      expect(payload.mcp.resultInfo).toEqual({
        returnedCount: 1,
        truncated: true,
        truncationReason: 'admin-cap',
      });
    } finally {
      vi.unstubAllEnvs();
      stubDefaultEnvVars();
    }
  });

  it('reports truncated:false when the full matching set is returned', async () => {
    mocks.mockGetFlowRuns.mockResolvedValue(buildRuns(3));
    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);
    expect(payload.flowRuns).toHaveLength(3);
    expect(payload.mcp.resultInfo).toEqual({ returnedCount: 3, truncated: false });
  });

  it('paginates across pages until a short page (no totalAvailable)', async () => {
    const page1 = buildRuns(100);
    const page2 = buildRuns(5, 'Success', 100); // distinct ids (run-100..run-104)
    mocks.mockGetFlowRuns.mockImplementation(({ pageNumber }: { pageNumber: number }) =>
      Promise.resolve(pageNumber === 1 ? page1 : page2),
    );

    // Explicit limit above the default backstop so the page loop (not the
    // backstop) governs and we still exercise the multi-page path.
    const result = await getToolResult({ limit: 150 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);

    expect(payload.flowRuns).toHaveLength(105);
    expect(payload.mcp.resultInfo).toEqual({ returnedCount: 105, truncated: false });
    expect(mocks.mockGetFlowRuns).toHaveBeenCalledTimes(2);
    expect(mocks.mockGetFlowRuns).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pageNumber: 2 }),
    );
  });

  it('applies the default backstop (newest 100) when no limit and no admin cap are set', async () => {
    // Page 1 fills the 100-run page; the short page 2 ends the walk after the
    // "+1 probe" has confirmed more than 100 runs exist.
    const page1 = buildRuns(100);
    const page2 = buildRuns(1, 'Success', 100); // distinct id (run-100) = the +1 probe
    mocks.mockGetFlowRuns.mockImplementation(({ pageNumber }: { pageNumber: number }) =>
      Promise.resolve(pageNumber === 1 ? page1 : page2),
    );

    const result = await getToolResult({});
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);

    expect(payload.flowRuns).toHaveLength(100);
    expect(payload.mcp.resultInfo).toEqual({
      returnedCount: 100,
      truncated: true,
      truncationReason: 'default-cap',
    });
  });

  it('de-duplicates runs that repeat across pages (unstable server ordering)', async () => {
    // The Get Flow Runs endpoint can return the same run on more than one page
    // when the sort key is missing/tied (e.g. Cancelled runs have no startedAt
    // and the default sort is startedAt:desc). page2 overlaps page1 by 10 ids;
    // page3 is short and ends the walk.
    const page1 = buildRuns(100, 'Success', 0); // run-000..run-099
    const page2 = buildRuns(100, 'Success', 90); // run-090..run-189 (10 overlap)
    const page3 = buildRuns(20, 'Success', 190); // run-190..run-209 (short page)
    mocks.mockGetFlowRuns.mockImplementation(({ pageNumber }: { pageNumber: number }) =>
      Promise.resolve(pageNumber === 1 ? page1 : pageNumber === 2 ? page2 : page3),
    );

    const result = await getToolResult({ limit: 1000 });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const payload = JSON.parse(result.content[0].text);

    const ids = payload.flowRuns.map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates leaked through
    expect(payload.flowRuns).toHaveLength(210); // 100 + 90 new + 20 new
    expect(payload.mcp.resultInfo).toEqual({ returnedCount: 210, truncated: false });
  });

  it('does NOT apply the default backstop when an admin cap is set (reports admin-cap)', async () => {
    vi.stubEnv('MAX_RESULT_LIMITS', 'list-flow-runs:2');
    try {
      mocks.mockGetFlowRuns.mockResolvedValue(buildRuns(3));
      const result = await getToolResult({});
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.flowRuns).toHaveLength(2);
      expect(payload.mcp.resultInfo).toEqual({
        returnedCount: 2,
        truncated: true,
        truncationReason: 'admin-cap',
      });
    } finally {
      vi.unstubAllEnvs();
      stubDefaultEnvVars();
    }
  });

  it('returns an error and fetches nothing on a server older than REST 3.10', async () => {
    mocks.mockVersionIsAtLeast.mockReturnValue(false);
    const result = await getToolResult({});
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('3.10');
    expect(mocks.mockGetFlowRuns).not.toHaveBeenCalled();
  });

  it('handles API errors gracefully', async () => {
    mocks.mockGetFlowRuns.mockRejectedValue(new Error('Runs boom'));
    const result = await getToolResult({ filter: `flowId:eq:${FLOW_ID}` });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Runs boom');
  });

  it('converts a 404 from a non-UUID flowId into an empty result with a recovery hint', async () => {
    // The Get Flow Runs endpoint returns 404 (not an empty list) when flowId
    // does not resolve to a real flow — confirmed live against Tableau Cloud.
    mocks.mockGetFlowRuns.mockRejectedValue(make404());
    const result = await getToolResult({ filter: 'flowId:eq:My Daily Flow' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No flow runs were found');
    expect(result.content[0].text).toContain('not a UUID');
    expect(result.content[0].text).toContain('list-flows');
  });

  it('converts a 404 from a nonexistent UUID flowId into the baseline empty message', async () => {
    mocks.mockGetFlowRuns.mockRejectedValue(make404());
    const result = await getToolResult({
      filter: 'flowId:eq:00000000-0000-0000-0000-000000000000',
    });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('No flow runs were found');
    expect(result.content[0].text).not.toContain('not a UUID');
  });

  it('does NOT swallow a 404 when no flowId filter is present', async () => {
    // A status-only filter is applied client-side, so serverFilter is empty and
    // has no flowId clause. A 404 here is unexpected and must surface as an error.
    mocks.mockGetFlowRuns.mockRejectedValue(make404());
    const result = await getToolResult({ filter: 'status:eq:Failed' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('404');
  });

  describe('failureInsight', () => {
    it('surfaces a run-history deep link when the window contains a failure', async () => {
      mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns); // one Failed run on FLOW_ID
      const result = await getToolResult({ filter: `flowId:eq:${FLOW_ID}` });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);

      expect(payload.mcp.failureInsight).toEqual({
        failedRunCount: 1,
        failedFlowCount: 1,
        example: {
          flowId: FLOW_ID,
          runHistoryUrl: `${FLOW_WEBPAGE_URL}/runHistory`,
        },
      });
      // Exactly one Query Flow call — only the example flow is resolved.
      expect(mocks.mockQueryFlow).toHaveBeenCalledTimes(1);
      expect(mocks.mockQueryFlow).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        flowId: FLOW_ID,
      });
    });

    it('omits failureInsight (and does not resolve a flow) when there are no failures', async () => {
      mocks.mockGetFlowRuns.mockResolvedValue(buildRuns(3, 'Success'));
      const result = await getToolResult({});
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);

      expect(payload.mcp.failureInsight).toBeUndefined();
      expect(mocks.mockQueryFlow).not.toHaveBeenCalled();
    });

    it('counts distinct failed flows but resolves only ONE example (single REST call)', async () => {
      const runs: FlowRun[] = [
        { id: 'f1000000-0000-0000-0000-000000000000', flowId: 'flow-aaaa', status: 'Failed', completedAt: '2026-06-11T10:00:00Z', progress: 100 },
        { id: 'f2000000-0000-0000-0000-000000000000', flowId: 'flow-bbbb', status: 'Failed', completedAt: '2026-06-10T10:00:00Z', progress: 100 },
        { id: 's1000000-0000-0000-0000-000000000000', flowId: 'flow-aaaa', status: 'Success', completedAt: '2026-06-09T10:00:00Z', progress: 100 },
      ];
      mocks.mockGetFlowRuns.mockResolvedValue(runs);

      const result = await getToolResult({});
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);

      expect(payload.mcp.failureInsight.failedRunCount).toBe(2);
      expect(payload.mcp.failureInsight.failedFlowCount).toBe(2);
      // Most-recent failure (newest completedAt) is the example.
      expect(payload.mcp.failureInsight.example.flowId).toBe('flow-aaaa');
      expect(mocks.mockQueryFlow).toHaveBeenCalledTimes(1);
      expect(mocks.mockQueryFlow).toHaveBeenCalledWith({
        siteId: 'test-site-id',
        flowId: 'flow-aaaa',
      });
    });

    it('still returns runs + failure counts (no example link) when flow resolution fails', async () => {
      mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);
      mocks.mockQueryFlow.mockRejectedValue(new Error('Query Flow boom'));

      const result = await getToolResult({ filter: `flowId:eq:${FLOW_ID}` });
      // The tool must NOT fail just because the link could not be resolved.
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);

      expect(payload.flowRuns.length).toBeGreaterThan(0);
      expect(payload.mcp.failureInsight).toEqual({
        failedRunCount: 1,
        failedFlowCount: 1,
      });
      expect(payload.mcp.failureInsight.example).toBeUndefined();
    });

    it('omits the example link when the resolved flow has no webpageUrl', async () => {
      mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);
      mocks.mockQueryFlow.mockResolvedValue({
        flow: { id: FLOW_ID, name: 'Daily Flow' }, // no webpageUrl
        outputSteps: [],
      });

      const result = await getToolResult({ filter: `flowId:eq:${FLOW_ID}` });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);

      expect(payload.mcp.failureInsight.failedRunCount).toBe(1);
      expect(payload.mcp.failureInsight.example).toBeUndefined();
    });
  });

  describe('constrainFlowRuns', () => {
    it('returns the baseline empty message when no runs are found', () => {
      const result = constrainFlowRuns({
        result: { flowRuns: [] },
        boundedContext: NO_BOUNDED_CONTEXT,
      });
      invariant(result.type === 'empty');
      expect(result.message).toContain('No flow runs were found');
    });

    it('attaches a flowId recovery hint when flowId is not a UUID and no runs are found', () => {
      const result = constrainFlowRuns({
        result: { flowRuns: [] },
        boundedContext: NO_BOUNDED_CONTEXT,
        validatedFilter: 'flowId:eq:My Daily Flow',
      });
      invariant(result.type === 'empty');
      expect(result.message).toContain('not a UUID');
      expect(result.message).toContain('list-flows');
    });

    it('does NOT attach the flowId hint when flowId IS a valid UUID', () => {
      const result = constrainFlowRuns({
        result: { flowRuns: [] },
        boundedContext: NO_BOUNDED_CONTEXT,
        validatedFilter: `flowId:eq:${FLOW_ID}`,
      });
      invariant(result.type === 'empty');
      expect(result.message).not.toContain('not a UUID');
    });

    it('fails closed under a projectIds bounded context', () => {
      const result = constrainFlowRuns({
        result: { flowRuns: mockFlowRuns },
        boundedContext: { ...NO_BOUNDED_CONTEXT, projectIds: new Set(['p1']) },
      });
      invariant(result.type === 'empty');
      expect(result.message).toContain('limited by the server configuration');
      expect(result.message).toContain('get-flow');
    });

    it('fails closed under a tags bounded context', () => {
      const result = constrainFlowRuns({
        result: { flowRuns: mockFlowRuns },
        boundedContext: { ...NO_BOUNDED_CONTEXT, tags: new Set(['t1']) },
      });
      invariant(result.type === 'empty');
      expect(result.message).toContain('limited by the server configuration');
    });

    it('carries the truncation signal through and recomputes returnedCount', () => {
      const result = constrainFlowRuns({
        result: {
          flowRuns: mockFlowRuns,
          mcp: { resultInfo: { returnedCount: 3, truncated: true, truncationReason: 'admin-cap' } },
        },
        boundedContext: NO_BOUNDED_CONTEXT,
      });
      invariant(result.type === 'success');
      expect(result.result.mcp.resultInfo).toEqual({
        returnedCount: mockFlowRuns.length,
        truncated: true,
        truncationReason: 'admin-cap',
      });
    });

    it('passes failureInsight through on the success path', () => {
      const failureInsight = {
        failedRunCount: 1,
        failedFlowCount: 1,
        example: { flowId: 'flow-aaaa', runHistoryUrl: 'https://x/#/flows/1/runHistory' },
      };
      const result = constrainFlowRuns({
        result: {
          flowRuns: mockFlowRuns,
          mcp: { resultInfo: { returnedCount: 3, truncated: false }, failureInsight },
        },
        boundedContext: NO_BOUNDED_CONTEXT,
      });
      invariant(result.type === 'success');
      expect(result.result.mcp.failureInsight).toEqual(failureInsight);
    });

    it('drops failureInsight when a bounded context forces an empty result', () => {
      const result = constrainFlowRuns({
        result: {
          flowRuns: mockFlowRuns,
          mcp: {
            resultInfo: { returnedCount: 3, truncated: false },
            failureInsight: { failedRunCount: 1, failedFlowCount: 1 },
          },
        },
        boundedContext: { ...NO_BOUNDED_CONTEXT, projectIds: new Set(['p1']) },
      });
      // Bounded context fails closed → empty result, so no link leaks out.
      invariant(result.type === 'empty');
    });
  });
});

function make404(): Error {
  const err = new Error('Request failed with status code 404') as Error & {
    isAxiosError: boolean;
    response: { status: number };
  };
  err.isAxiosError = true;
  err.response = { status: 404 };
  return err;
}

async function getToolResult(params: {
  filter?: string;
  sort?: string;
  limit?: number;
}): Promise<CallToolResult> {
  const tool = getListFlowRunsTool(new WebMcpServer());
  const callback = await Provider.from(tool.callback);
  return await callback(
    { filter: params.filter, sort: params.sort, limit: params.limit },
    getMockRequestHandlerExtra(),
  );
}
