import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useRestApi } from '../../../../restApiInstance.js';
import { WebMcpServer } from '../../../../server.web.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import { getGetFlowTool } from './getFlow.js';
import { mockConnections, mockFlow, mockFlowRuns, mockOutputSteps } from './mockFlow.js';

const mocks = vi.hoisted(() => ({
  mockQueryFlow: vi.fn(),
  mockQueryFlowConnections: vi.fn(),
  mockGetFlowRuns: vi.fn(),
  mockVersionIsAtLeast: vi.fn((_version: `${number}.${number}`): boolean => true),
  mockIsFlowAllowed: vi.fn(),
}));

vi.mock('../../resourceAccessChecker.js', () => ({
  resourceAccessChecker: {
    isFlowAllowed: mocks.mockIsFlowAllowed,
  },
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
        queryFlow: mocks.mockQueryFlow,
        queryFlowConnections: mocks.mockQueryFlowConnections,
        getFlowRuns: mocks.mockGetFlowRuns,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('getFlowTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockVersionIsAtLeast.mockReturnValue(true);
    // Default: no bounded context → the gate allows the flow and fetches no
    // content of its own (get-flow performs the Query Flow call).
    mocks.mockIsFlowAllowed.mockResolvedValue({ allowed: true });
  });

  it('should create a tool instance with correct properties', () => {
    const getFlowTool = getGetFlowTool(new WebMcpServer());
    expect(getFlowTool.name).toBe('get-flow');
    expect(getFlowTool.description).toContain('Retrieves detailed information');
    expect(getFlowTool.paramsSchema).toMatchObject({ flowId: expect.any(Object) });
  });

  it('should fetch flow with all sidecars by default', async () => {
    mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
    mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
    mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(mockFlow.id);
    expect(parsed.name).toBe(mockFlow.name);
    expect(parsed.outputSteps).toEqual(mockOutputSteps);
    expect(parsed.connections).toEqual(mockConnections);
    expect(parsed.flowRuns).toEqual(mockFlowRuns);
    expect(parsed.mcp).toBeUndefined();

    expect(mocks.mockGetFlowRuns).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: `flowId:eq:${mockFlow.id}`,
      sort: 'startedAt:desc',
      // pageSize is `flowRunLimit + 1` — the "+1 probe" used to detect
      // truncation in a single REST round-trip (Tableau's runs endpoint
      // returns no `pagination` block, verified live on REST 3.30).
      pageSize: 11,
    });
  });

  it('should skip connections when includeConnections=false', async () => {
    mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
    mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);

    const result = await getToolResult({ flowId: mockFlow.id, includeConnections: false });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.connections).toBeUndefined();
    expect(parsed.flowRuns).toEqual(mockFlowRuns);
    expect(mocks.mockQueryFlowConnections).not.toHaveBeenCalled();
  });

  it('should skip flow runs when includeFlowRuns=false', async () => {
    mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
    mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);

    const result = await getToolResult({ flowId: mockFlow.id, includeFlowRuns: false });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.connections).toEqual(mockConnections);
    expect(parsed.flowRuns).toBeUndefined();
    expect(mocks.mockGetFlowRuns).not.toHaveBeenCalled();
  });

  it('should respect custom flowRunLimit', async () => {
    mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
    mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
    mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);

    await getToolResult({ flowId: mockFlow.id, flowRunLimit: 5 });
    expect(mocks.mockGetFlowRuns).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 6 }));
  });

  it('should fail atomically when the primary Query Flow call fails', async () => {
    mocks.mockQueryFlow.mockRejectedValue(new Error('Flow not found'));

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Flow not found');
  });

  it('should emit SIDECAR_FETCH_FAILED warning when connections sidecar fails', async () => {
    mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
    mocks.mockQueryFlowConnections.mockRejectedValue(new Error('Connections forbidden'));
    mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.connections).toBeUndefined();
    expect(parsed.flowRuns).toEqual(mockFlowRuns);
    expect(parsed.mcp.warnings).toHaveLength(1);
    expect(parsed.mcp.warnings[0]).toMatchObject({
      type: 'SIDECAR_FETCH_FAILED',
      severity: 'WARNING',
      affectedField: 'connections',
    });
    expect(parsed.mcp.warnings[0].message).toContain('Connections forbidden');
  });

  it('should emit two warnings when both sidecars fail', async () => {
    mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
    mocks.mockQueryFlowConnections.mockRejectedValue(new Error('Connections boom'));
    mocks.mockGetFlowRuns.mockRejectedValue(new Error('Runs boom'));

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.connections).toBeUndefined();
    expect(parsed.flowRuns).toBeUndefined();
    expect(parsed.mcp.warnings).toHaveLength(2);
    expect(parsed.mcp.warnings.map((w: { affectedField: string }) => w.affectedField)).toEqual([
      'connections',
      'flowRuns',
    ]);
  });

  it('should emit VERSION_GATE_SKIPPED warning on Tableau < 3.10 when flow runs are requested', async () => {
    mocks.mockVersionIsAtLeast.mockReturnValue(false);
    mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
    mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.flowRuns).toBeUndefined();
    expect(mocks.mockGetFlowRuns).not.toHaveBeenCalled();
    expect(parsed.mcp.warnings).toHaveLength(1);
    expect(parsed.mcp.warnings[0]).toMatchObject({
      type: 'VERSION_GATE_SKIPPED',
      severity: 'WARNING',
      affectedField: 'flowRuns',
    });
  });

  it('should not surface password-related fields in the response', async () => {
    mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
    mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
    mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);

    const result = await getToolResult({ flowId: mockFlow.id });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    // The connections response intentionally exposes embedPassword as a boolean flag,
    // but never an actual password string. Make sure that contract holds.
    expect(result.content[0].text).not.toMatch(/"password"\s*:\s*"[^"]+"/);
    expect(result.content[0].text).not.toMatch(/X-Tableau-Auth/);
  });

  // ------------------------------------------------------------------------
  // FLOW_RUNS_TRUNCATED warning — "+1 probe" detection
  // ------------------------------------------------------------------------
  // The Tableau Flow Runs endpoint does not return a `pagination` block, so
  // `get-flow` cannot read `totalAvailable` to know whether the response was
  // truncated. Instead it requests `flowRunLimit + 1` rows in a single call;
  // if more than `flowRunLimit` come back, the array is truncated and a
  // FLOW_RUNS_TRUNCATED warning is emitted. These tests pin every branch.
  describe('FLOW_RUNS_TRUNCATED warning', () => {
    function buildFlowRuns(count: number): Array<{
      id: string;
      flowId: string;
      status: string;
      startedAt: string;
      completedAt: string;
      progress: number;
      backgroundJobId: string;
    }> {
      return Array.from({ length: count }, (_, i) => ({
        id: `run-${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
        flowId: mockFlow.id,
        status: 'Success',
        startedAt: `2025-01-${String((i % 28) + 1).padStart(2, '0')}T10:00:00Z`,
        completedAt: `2025-01-${String((i % 28) + 1).padStart(2, '0')}T10:05:00Z`,
        progress: 100,
        backgroundJobId: `job-${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
      }));
    }

    it('emits FLOW_RUNS_TRUNCATED + slices the array when Tableau returns flowRunLimit+1 rows', async () => {
      mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
      mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
      // flowRunLimit=10 → tool requests pageSize=11 → mock returns 11.
      // Truncation MUST be detected and the array sliced to 10.
      mocks.mockGetFlowRuns.mockResolvedValue(buildFlowRuns(11));

      const result = await getToolResult({ flowId: mockFlow.id, flowRunLimit: 10 });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.flowRuns).toHaveLength(10);
      expect(parsed.mcp.warnings).toHaveLength(1);
      expect(parsed.mcp.warnings[0]).toMatchObject({
        type: 'FLOW_RUNS_TRUNCATED',
        severity: 'WARNING',
        affectedField: 'flowRuns',
        returnedCount: 10,
      });
      // The warning message must coach the LLM toward both recovery paths:
      // (1) re-call with higher flowRunLimit, (2) for >100 runs use the REST API.
      expect(parsed.mcp.warnings[0].message).toContain('flowRunLimit');
      expect(parsed.mcp.warnings[0].message).toContain('100');
      expect(parsed.mcp.warnings[0].message).toContain('REST API');
      expect(parsed.mcp.warnings[0].message).toContain(mockFlow.id);
    });

    it('does NOT emit FLOW_RUNS_TRUNCATED when Tableau returns exactly flowRunLimit rows', async () => {
      // Boundary case: a flow with exactly N runs returns N rows when we ask for
      // N+1. No extra row → no truncation. This is the false-positive guard.
      mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
      mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
      mocks.mockGetFlowRuns.mockResolvedValue(buildFlowRuns(10));

      const result = await getToolResult({ flowId: mockFlow.id, flowRunLimit: 10 });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.flowRuns).toHaveLength(10);
      expect(parsed.mcp).toBeUndefined();
    });

    it('does NOT emit FLOW_RUNS_TRUNCATED when Tableau returns fewer than flowRunLimit rows', async () => {
      mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
      mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
      mocks.mockGetFlowRuns.mockResolvedValue(buildFlowRuns(3));

      const result = await getToolResult({ flowId: mockFlow.id, flowRunLimit: 10 });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.flowRuns).toHaveLength(3);
      expect(parsed.mcp).toBeUndefined();
    });

    it('does NOT emit FLOW_RUNS_TRUNCATED on an empty run history', async () => {
      mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
      mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
      mocks.mockGetFlowRuns.mockResolvedValue([]);

      const result = await getToolResult({ flowId: mockFlow.id, flowRunLimit: 10 });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.flowRuns).toEqual([]);
      expect(parsed.mcp).toBeUndefined();
    });

    it('co-exists with SIDECAR_FETCH_FAILED when connections fail and runs are truncated', async () => {
      mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
      mocks.mockQueryFlowConnections.mockRejectedValue(new Error('Connections forbidden'));
      mocks.mockGetFlowRuns.mockResolvedValue(buildFlowRuns(11));

      const result = await getToolResult({ flowId: mockFlow.id, flowRunLimit: 10 });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.flowRuns).toHaveLength(10);
      expect(parsed.connections).toBeUndefined();
      expect(parsed.mcp.warnings).toHaveLength(2);
      const types = parsed.mcp.warnings.map((w: { type: string }) => w.type).sort();
      expect(types).toEqual(['FLOW_RUNS_TRUNCATED', 'SIDECAR_FETCH_FAILED']);
    });

    it('truncates correctly at the new max (flowRunLimit=100, mock returns 101)', async () => {
      mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
      mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
      mocks.mockGetFlowRuns.mockResolvedValue(buildFlowRuns(101));

      const result = await getToolResult({ flowId: mockFlow.id, flowRunLimit: 100 });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.flowRuns).toHaveLength(100);
      expect(parsed.mcp.warnings).toHaveLength(1);
      expect(parsed.mcp.warnings[0]).toMatchObject({
        type: 'FLOW_RUNS_TRUNCATED',
        returnedCount: 100,
      });
      // Confirm the underlying REST call asked for pageSize=101 (100 + 1 probe).
      expect(mocks.mockGetFlowRuns).toHaveBeenCalledWith(
        expect.objectContaining({ pageSize: 101 }),
      );
    });

    it('also slices when mock returns far more than flowRunLimit+1 (defensive)', async () => {
      // Schema-level slicing must hold even if the SDK ever returns more than
      // pageSize (e.g. server-side bug). Defensive assertion.
      mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
      mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
      mocks.mockGetFlowRuns.mockResolvedValue(buildFlowRuns(50));

      const result = await getToolResult({ flowId: mockFlow.id, flowRunLimit: 5 });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.flowRuns).toHaveLength(5);
      expect(parsed.mcp.warnings).toHaveLength(1);
      expect(parsed.mcp.warnings[0].type).toBe('FLOW_RUNS_TRUNCATED');
    });
  });

  // ------------------------------------------------------------------------
  // Dynamic JWT scopes — P1 fix
  // ------------------------------------------------------------------------
  // The tool used to pass the static `getFlowTool.requiredApiScopes` (the
  // maximum-possible superset including flow_connections + flow_runs) into
  // `useRestApi`'s `jwtScopes`. Tableau Connected Apps reject a JWT mint
  // that requests un-granted scopes during sign-in, so an operator who
  // deployed a metadata-only connected app (no flow_connections / flow_runs
  // grants) saw `get-flow` fail at sign-in even when the caller passed
  // includeConnections:false / includeFlowRuns:false. Now the callback
  // computes the smallest viable scope set per call. These tests pin that
  // contract.
  describe('dynamic JWT scopes per call (P1)', () => {
    function getJwtScopesFromLastCall(): readonly string[] {
      const calls = vi.mocked(useRestApi).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const lastArg = calls[calls.length - 1][0] as { jwtScopes: readonly string[] };
      return lastArg.jwtScopes;
    }

    beforeEach(() => {
      mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
      mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
      mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);
    });

    it('requests both sidecar scopes when both sidecars are enabled (default path)', async () => {
      await getToolResult({ flowId: mockFlow.id });
      const scopes = getJwtScopesFromLastCall();
      expect(scopes).toEqual(
        expect.arrayContaining([
          'tableau:flows:read',
          'tableau:mcp_site_settings:read',
          'tableau:flow_connections:read',
          'tableau:flow_runs:read',
        ]),
      );
      expect(scopes).toHaveLength(4);
    });

    it('omits flow_connections:read when includeConnections=false', async () => {
      await getToolResult({ flowId: mockFlow.id, includeConnections: false });
      const scopes = getJwtScopesFromLastCall();
      expect(scopes).toContain('tableau:flows:read');
      expect(scopes).toContain('tableau:mcp_site_settings:read');
      expect(scopes).toContain('tableau:flow_runs:read');
      expect(scopes).not.toContain('tableau:flow_connections:read');
    });

    it('omits flow_runs:read when includeFlowRuns=false', async () => {
      await getToolResult({ flowId: mockFlow.id, includeFlowRuns: false });
      const scopes = getJwtScopesFromLastCall();
      expect(scopes).toContain('tableau:flows:read');
      expect(scopes).toContain('tableau:mcp_site_settings:read');
      expect(scopes).toContain('tableau:flow_connections:read');
      expect(scopes).not.toContain('tableau:flow_runs:read');
    });

    it('requests only baseline scopes for a metadata-only call (both sidecars off)', async () => {
      // The whole point of P1: a metadata-only call must succeed against a
      // connected app that grants only `tableau:flows:read` + the always-on
      // site-settings scope. Neither flow_connections nor flow_runs may be
      // requested at JWT mint time.
      await getToolResult({
        flowId: mockFlow.id,
        includeConnections: false,
        includeFlowRuns: false,
      });
      const scopes = getJwtScopesFromLastCall();
      expect(scopes).toEqual(
        expect.arrayContaining(['tableau:flows:read', 'tableau:mcp_site_settings:read']),
      );
      expect(scopes).toHaveLength(2);
      expect(scopes).not.toContain('tableau:flow_connections:read');
      expect(scopes).not.toContain('tableau:flow_runs:read');
    });
  });

  // ------------------------------------------------------------------------
  // Schema boundary validation for the new flowRunLimit max (100)
  // ------------------------------------------------------------------------
  // Schema-bound checks must hit the zod schema directly — the unit harness
  // calls `tool.callback(params, extra)` which bypasses the MCP framework's
  // input validation (that runs in the JSON-RPC layer). The live verifier
  // exercises end-to-end validation; here we assert the schema contract.
  // `paramsSchema` is wrapped in `TypeOrProvider`, so we resolve it through
  // `Provider.from` before reaching into individual fields.
  describe('flowRunLimit schema bounds', () => {
    async function getFlowRunLimitSchema(): Promise<{
      safeParse: (v: unknown) => { success: boolean; data?: unknown; error?: { issues: unknown } };
    }> {
      const tool = getGetFlowTool(new WebMcpServer());
      const schema = await Provider.from(tool.paramsSchema);
      return schema.flowRunLimit;
    }

    it('accepts flowRunLimit=1 (min boundary)', async () => {
      const s = await getFlowRunLimitSchema();
      expect(s.safeParse(1).success).toBe(true);
    });

    it('accepts flowRunLimit=100 (new max boundary)', async () => {
      const s = await getFlowRunLimitSchema();
      expect(s.safeParse(100).success).toBe(true);
    });

    it('rejects flowRunLimit=101 (one above new max)', async () => {
      const s = await getFlowRunLimitSchema();
      const r = s.safeParse(101);
      expect(r.success).toBe(false);
      if (!r.success && r.error) {
        // Confirm the error references the upper bound (100) so the user-facing
        // message stays informative even if the schema author tweaks wording.
        expect(JSON.stringify(r.error.issues)).toMatch(/100/);
      }
    });

    it('rejects flowRunLimit=0 (below min)', async () => {
      const s = await getFlowRunLimitSchema();
      expect(s.safeParse(0).success).toBe(false);
    });

    it('rejects non-integer flowRunLimit (e.g. 10.5)', async () => {
      const s = await getFlowRunLimitSchema();
      expect(s.safeParse(10.5).success).toBe(false);
    });

    it('defaults to 10 when omitted', async () => {
      const s = await getFlowRunLimitSchema();
      const r = s.safeParse(undefined);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data).toBe(10);
    });
  });

  // get-flow must honor the same PROJECT_IDS / TAGS bounded context as
  // list-flows (and get-workbook). The access check runs BEFORE any flow
  // detail or sidecar fetch, so a flow outside the allowed set can never be
  // read by id.
  describe('bounded-context gate', () => {
    it('returns an error and fetches nothing when the flow is not allowed', async () => {
      mocks.mockIsFlowAllowed.mockResolvedValue({
        allowed: false,
        message:
          'The set of allowed flows that can be queried is limited by the server configuration. The flow with LUID xyz cannot be queried because it does not belong to an allowed project.',
      });

      const result = await getToolResult({ flowId: mockFlow.id });
      expect(result.isError).toBe(true);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('limited by the server configuration');
      // Nothing is fetched once the gate denies access.
      expect(mocks.mockQueryFlow).not.toHaveBeenCalled();
      expect(mocks.mockQueryFlowConnections).not.toHaveBeenCalled();
      expect(mocks.mockGetFlowRuns).not.toHaveBeenCalled();
    });

    it('reuses the flow fetched by the access check instead of querying it again', async () => {
      // When a project/tag bounded context is active, the checker returns the
      // already-fetched flow as `content`. get-flow reuses it (no second Query
      // Flow call) while still fetching the requested sidecars.
      mocks.mockIsFlowAllowed.mockResolvedValue({
        allowed: true,
        content: { flow: mockFlow, outputSteps: mockOutputSteps },
      });
      mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
      mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);

      const result = await getToolResult({ flowId: mockFlow.id });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.id).toBe(mockFlow.id);
      expect(parsed.outputSteps).toEqual(mockOutputSteps);
      expect(parsed.connections).toEqual(mockConnections);

      expect(mocks.mockQueryFlow).not.toHaveBeenCalled();
      expect(mocks.mockQueryFlowConnections).toHaveBeenCalledTimes(1);
    });

    it('fetches the flow itself when the access check returns no content', async () => {
      // Default `{ allowed: true }` (no content, e.g. no bounded context) — the
      // tool falls back to its own Query Flow call.
      mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
      mocks.mockQueryFlowConnections.mockResolvedValue(mockConnections);
      mocks.mockGetFlowRuns.mockResolvedValue(mockFlowRuns);

      const result = await getToolResult({ flowId: mockFlow.id });
      expect(result.isError).toBe(false);
      expect(mocks.mockQueryFlow).toHaveBeenCalledTimes(1);
    });
  });
});

async function getToolResult(params: {
  flowId: string;
  includeConnections?: boolean;
  includeFlowRuns?: boolean;
  flowRunLimit?: number;
}): Promise<CallToolResult> {
  const getFlowTool = getGetFlowTool(new WebMcpServer());
  const callback = await Provider.from(getFlowTool.callback);
  return await callback(
    {
      flowId: params.flowId,
      includeConnections: params.includeConnections ?? true,
      includeFlowRuns: params.includeFlowRuns ?? true,
      flowRunLimit: params.flowRunLimit ?? 10,
    },
    getMockRequestHandlerExtra(),
  );
}
