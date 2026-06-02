import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { WebMcpServer } from '../../../../server.web.js';
import { stubDefaultEnvVars } from '../../../../testShared.js';
import { getCombinationsOfBoundedContextInputs } from '../../../../utils/getCombinationsOfBoundedContextInputs.js';
import invariant from '../../../../utils/invariant.js';
import { Provider } from '../../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../../toolContext.mock.js';
import {
  extractOwnerNameEqValue,
  extractProjectIdEqValue,
  looksLikeLoginNotFullName,
  looksLikeUuid,
} from './flowsFilterUtils.js';
import { buildTruncationInfo, constrainFlows, getListFlowsTool } from './listFlows.js';
import { mockFlows } from './mockFlows.js';

const mocks = vi.hoisted(() => ({
  mockQueryFlowsForSite: vi.fn(),
}));

vi.mock('../../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      flowsMethods: {
        queryFlowsForSite: mocks.mockQueryFlowsForSite,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('listFlowsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should create a tool instance with correct properties', () => {
    const listFlowsTool = getListFlowsTool(new WebMcpServer());
    expect(listFlowsTool.name).toBe('list-flows');
    expect(listFlowsTool.description).toContain('Retrieves a list of Tableau Prep flows');
    expect(listFlowsTool.paramsSchema).toMatchObject({ filter: expect.any(Object) });
  });

  it('should successfully list flows', async () => {
    mocks.mockQueryFlowsForSite.mockResolvedValue(mockFlows);
    const result = await getToolResult({ filter: 'name:eq:Sales Cleanup' });
    expect(result.isError).toBe(false);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('Sales Cleanup');
    expect(mocks.mockQueryFlowsForSite).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'name:eq:Sales Cleanup',
      sort: undefined,
      pageSize: undefined,
      pageNumber: undefined,
    });
  });

  it('should pass sort expression through to the API', async () => {
    mocks.mockQueryFlowsForSite.mockResolvedValue(mockFlows);
    const result = await getToolResult({ filter: '', sort: 'createdAt:desc' });
    expect(result.isError).toBe(false);
    expect(mocks.mockQueryFlowsForSite).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: '',
      sort: 'createdAt:desc',
      pageSize: undefined,
      pageNumber: undefined,
    });
  });

  it('should reject filter strings with unsupported fields', async () => {
    await expect(getToolResult({ filter: 'unknownField:eq:foo' })).rejects.toThrow();
  });

  it.each(['ownerEmail', 'ownerDomain', 'tags'])(
    'should reject %s filter (Tableau Flows endpoint does not support it server-side)',
    async (field) => {
      await expect(getToolResult({ filter: `${field}:eq:value` })).rejects.toThrow();
    },
  );

  // Per the official spec (https://help.tableau.com/.../rest_api_concepts_filtering_and_sorting.htm,
  // "Flows" table) `ownerName` and `projectId` are `eq`-only — `:in:` is rejected by Tableau.
  it.each(['ownerName', 'projectId'])(
    'should reject %s:in:[…] (Tableau Flows endpoint allows :eq: only on this field)',
    async (field) => {
      await expect(getToolResult({ filter: `${field}:in:[a,b]` })).rejects.toThrow();
    },
  );

  it('should accept the new projectId:eq:<uuid> filter', async () => {
    mocks.mockQueryFlowsForSite.mockResolvedValue(mockFlows);
    const result = await getToolResult({
      filter: 'projectId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3',
    });
    expect(result.isError).toBe(false);
    expect(mocks.mockQueryFlowsForSite).toHaveBeenCalledWith({
      siteId: 'test-site-id',
      filter: 'projectId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3',
      sort: undefined,
      pageSize: undefined,
      pageNumber: undefined,
    });
  });

  it('should reject filter strings with unsupported operators', async () => {
    // 'has' is not in FilterOperatorSchema
    await expect(getToolResult({ filter: 'name:has:Sales' })).rejects.toThrow();
  });

  it('should handle API errors gracefully', async () => {
    const errorMessage = 'API Error';
    mocks.mockQueryFlowsForSite.mockRejectedValue(new Error(errorMessage));
    const result = await getToolResult({ filter: 'name:eq:Sales Cleanup' });
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain(errorMessage);
  });

  describe('constrainFlows', () => {
    it('should return empty result when no flows are found', () => {
      const result = constrainFlows({
        result: { flows: [] },
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No flows were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty results when all flows were filtered out by the bounded context', () => {
      const result = constrainFlows({
        result: { flows: mockFlows.flows },
        boundedContext: {
          projectIds: new Set(['some-other-project']),
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        [
          'The set of allowed flows that can be queried is limited by the server configuration.',
          'While flows were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    test.each(
      getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set([mockFlows.flows[0].project.id])],
        datasourceIds: [null], // n/a for flows
        workbookIds: [null], // n/a for flows
        viewIds: [null], // n/a for flows
        tags: [null, new Set([mockFlows.flows[0].tags.tag[0].label])],
      }),
    )(
      'should return success result when the bounded context is projectIds: $projectIds, tags: $tags',
      async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
        const result = constrainFlows({
          result: { flows: mockFlows.flows },
          boundedContext: {
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          },
        });

        invariant(result.type === 'success');
        const expectedFlows = !projectIds && !tags ? mockFlows.flows : [mockFlows.flows[0]];
        expect(result.result).toEqual({
          flows: expectedFlows,
          mcp: { resultInfo: { returnedCount: expectedFlows.length, truncated: false } },
        });
      },
    );

    it('carries the truncation signal through bounded-context filtering and recomputes returnedCount', () => {
      // truncated/truncationReason are computed upstream (in the tool callback)
      // from the server-side page loop. Bounded-context filtering drops a flow
      // here, so returnedCount must be recomputed (2 -> 1), but the "more exist
      // on the server" signal stays: there are flows beyond the admin cap that
      // we never fetched and could not evaluate against the bounded context.
      const result = constrainFlows({
        result: {
          flows: mockFlows.flows,
          mcp: { resultInfo: { returnedCount: 2, truncated: true, truncationReason: 'admin-cap' } },
        },
        boundedContext: {
          projectIds: new Set([mockFlows.flows[0].project.id]),
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result.flows).toEqual([mockFlows.flows[0]]);
      expect(result.result.mcp.resultInfo).toEqual({
        returnedCount: 1,
        truncated: true,
        truncationReason: 'admin-cap',
      });
    });

    it('surfaces totalAvailable when no bounded context is configured', () => {
      // With no PROJECT_IDS/TAGS, returnedCount and the server-side totalAvailable
      // count the same population, so the model can safely report "N of M".
      const result = constrainFlows({
        result: {
          flows: mockFlows.flows,
          mcp: {
            resultInfo: {
              returnedCount: 2,
              truncated: true,
              truncationReason: 'requested-limit',
              totalAvailable: 430,
            },
          },
        },
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result.mcp.resultInfo).toEqual({
        returnedCount: 2,
        truncated: true,
        truncationReason: 'requested-limit',
        totalAvailable: 430,
      });
    });

    it('omits totalAvailable when a bounded context is active (server count predates allow-list filtering)', () => {
      // Tableau's totalAvailable is taken before client-side bounded-context
      // filtering, so under PROJECT_IDS/TAGS it would overstate the accessible
      // total. We drop it rather than report a misleading "N of M".
      const result = constrainFlows({
        result: {
          flows: mockFlows.flows,
          mcp: {
            resultInfo: { returnedCount: 2, truncated: false, totalAvailable: 430 },
          },
        },
        boundedContext: {
          projectIds: new Set([mockFlows.flows[0].project.id]),
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result.flows).toEqual([mockFlows.flows[0]]);
      expect(result.result.mcp.resultInfo).toEqual({
        returnedCount: 1,
        truncated: false,
      });
      expect(result.result.mcp.resultInfo.totalAvailable).toBeUndefined();
    });
  });

  // The site administrator can configure `MAX_RESULT_LIMITS=list-flows:N` (or
  // `MAX_RESULT_LIMIT=N` repo-wide) to cap how many flows the tool returns per
  // call. The caller's own `limit` argument can likewise cut the result short.
  // `mcp.resultInfo` reports both: `truncated`, plus a `truncationReason` of
  // `'admin-cap'` or `'requested-limit'`. Without it the LLM could not tell
  // "all the flows" from "the first N of more" and would misreport partial
  // results as complete. These tests pin the classification rules.
  describe('buildTruncationInfo', () => {
    it('reports admin-cap when the cap truncated AND the caller passed no limit', () => {
      expect(
        buildTruncationInfo({
          truncatedByLimit: true,
          maxResultLimit: 100,
          llmLimit: undefined,
          effectiveLimit: 100,
        }),
      ).toEqual({ truncated: true, truncationReason: 'admin-cap' });
    });

    it('reports admin-cap when the caller-supplied limit was higher than the cap (cap won)', () => {
      expect(
        buildTruncationInfo({
          truncatedByLimit: true,
          maxResultLimit: 100,
          llmLimit: 1000,
          effectiveLimit: 100,
        }),
      ).toEqual({ truncated: true, truncationReason: 'admin-cap' });
    });

    it('reports requested-limit when the caller-supplied limit was the binding constraint', () => {
      // Admin cap is 100 but the caller only asked for 10 — the caller's intent,
      // not the operator's.
      expect(
        buildTruncationInfo({
          truncatedByLimit: true,
          maxResultLimit: 100,
          llmLimit: 10,
          effectiveLimit: 10,
        }),
      ).toEqual({ truncated: true, truncationReason: 'requested-limit' });
    });

    it('reports requested-limit when the caller-supplied limit exactly equals the cap', () => {
      // limit === cap: attribute to the caller's explicit ask, not the operator.
      expect(
        buildTruncationInfo({
          truncatedByLimit: true,
          maxResultLimit: 100,
          llmLimit: 100,
          effectiveLimit: 100,
        }),
      ).toEqual({ truncated: true, truncationReason: 'requested-limit' });
    });

    it('reports requested-limit when there is no admin cap', () => {
      expect(
        buildTruncationInfo({
          truncatedByLimit: true,
          maxResultLimit: null,
          llmLimit: 50,
          effectiveLimit: 50,
        }),
      ).toEqual({ truncated: true, truncationReason: 'requested-limit' });
    });

    it('reports not-truncated (no reason) when nothing was cut off', () => {
      expect(
        buildTruncationInfo({
          truncatedByLimit: false,
          maxResultLimit: 100,
          llmLimit: undefined,
          effectiveLimit: 100,
        }),
      ).toEqual({ truncated: false });
    });

    it('integration: tool-call reports truncationReason admin-cap when the cap caps the response', async () => {
      // Stub the per-tool admin cap at 1 so the first paginate page (mockFlows
      // has 2 entries with totalAvailable=2) is truncated: returned 1, total 2.
      // Restore the suite-level env stubs in `finally` — `vi.unstubAllEnvs()`
      // would also nuke the default SERVER/etc. that `testSetup.ts` installs.
      vi.stubEnv('MAX_RESULT_LIMITS', 'list-flows:1');
      try {
        mocks.mockQueryFlowsForSite.mockResolvedValue({
          pagination: { pageNumber: 1, pageSize: 10, totalAvailable: 2 },
          flows: mockFlows.flows,
        });
        const result = await getToolResult({ filter: '' });
        expect(result.isError).toBe(false);
        invariant(result.content[0].type === 'text');
        const payload = JSON.parse(result.content[0].text);
        expect(payload.flows).toHaveLength(1);
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

    it('integration: tool-call reports truncated:false when the full matching set is returned', async () => {
      // No admin cap, no limit, totalAvailable === returned → complete set.
      // `mcp.resultInfo` is still present (always emitted) with truncated:false
      // and no truncationReason.
      mocks.mockQueryFlowsForSite.mockResolvedValue(mockFlows);
      const result = await getToolResult({ filter: '' });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      const payload = JSON.parse(result.content[0].text);
      expect(payload.flows).toHaveLength(mockFlows.flows.length);
      expect(payload.mcp.resultInfo).toEqual({
        returnedCount: mockFlows.flows.length,
        truncated: false,
        totalAvailable: mockFlows.flows.length,
      });
    });
  });

  // The Tableau Flows REST API silently returns 0 results when an `ownerName:eq:<value>`
  // filter is supplied with a value that doesn't exactly match a user's `fullName`
  // (display name). Because login/email/userId are common identifiers, this trap is
  // easy to fall into and indistinguishable from "no flows match this owner". Pin the
  // empty-result enrichment so the LLM gets a recoverable signal instead of a silent
  // empty array.
  describe('ownerName fullName-only filter trap (recovery hint)', () => {
    describe('extractOwnerNameEqValue helper', () => {
      it.each([
        ['ownerName:eq:Jane Doe', 'Jane Doe'],
        ['ownerName:eq:jane.doe@example.com', 'jane.doe@example.com'],
        ['ownerName:eq:value:with:colons', 'value:with:colons'],
        ['name:eq:Sales,ownerName:eq:Jane Doe', 'Jane Doe'],
        ['ownerName:eq:Jane Doe,projectName:eq:Finance', 'Jane Doe'],
      ])('extracts the value from %s', (input, expected) => {
        expect(extractOwnerNameEqValue(input)).toBe(expected);
      });

      it.each([undefined, '', 'name:eq:Sales', 'projectId:eq:abc-123'])(
        'returns undefined for filter without ownerName:eq clause: %s',
        (input) => {
          expect(extractOwnerNameEqValue(input)).toBeUndefined();
        },
      );
    });

    describe('looksLikeLoginNotFullName heuristic', () => {
      it.each([
        ['user@example.com', true],
        ['jane.doe@example.com', true],
        ['711e59cf-d1c0-446e-be48-3673ae067f7b', true],
        ['jane.doe', true],
        ['admin', true],
        ['Jane Doe', false],
        ['Jialin Mao', false],
        ['Some User With Long Name', false],
        ['', false],
        ['  ', false],
      ])('classifies %s correctly (expected=%s)', (input, expected) => {
        expect(looksLikeLoginNotFullName(input)).toBe(expected);
      });
    });

    it('attaches a recovery hint to the empty message when ownerName:eq:<email> returns 0 flows', () => {
      const result = constrainFlows({
        result: { flows: [] },
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
        validatedFilter: 'ownerName:eq:user@example.com',
      });

      invariant(result.type === 'empty');
      expect(result.message).toContain('No flows were found');
      expect(result.message).toContain('user@example.com');
      expect(result.message).toContain('fullName');
      expect(result.message).toContain('To recover:');
      expect(result.message).toContain('Users REST API');
      expect(result.message).toContain('projectId:eq:');
    });

    it('attaches a recovery hint when ownerName:eq:<userId-uuid> returns 0 flows', () => {
      const result = constrainFlows({
        result: { flows: [] },
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
        validatedFilter: 'ownerName:eq:711e59cf-d1c0-446e-be48-3673ae067f7b',
      });

      invariant(result.type === 'empty');
      expect(result.message).toContain('looks like a login, email, or user id');
    });

    it('does NOT attach the hint when ownerName:eq:<plausible fullName> returns 0 flows', () => {
      const result = constrainFlows({
        result: { flows: [] },
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
        validatedFilter: 'ownerName:eq:Jane Doe',
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No flows were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('does NOT attach the hint when filter has no ownerName clause', () => {
      const result = constrainFlows({
        result: { flows: [] },
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
        validatedFilter: 'projectName:eq:Finance',
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No flows were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('integration: tool-call response surfaces the recovery hint when ownerName:eq:<email> matches no flows', async () => {
      mocks.mockQueryFlowsForSite.mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 0 },
        flows: [],
      });
      const result = await getToolResult({ filter: 'ownerName:eq:user@example.com' });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('user@example.com');
      expect(result.content[0].text).toContain('fullName');
      expect(result.content[0].text).toContain('To recover:');
    });
  });

  // The Tableau Flows REST API silently returns 0 results when `projectId:eq:<v>`
  // is supplied with a value that isn't a real project UUID. Same trap shape as
  // the ownerName one — pin the recovery-hint behavior so an LLM that passes a
  // project name (or other non-UUID identifier) gets a recoverable signal.
  describe('projectId malformed-value trap (recovery hint)', () => {
    describe('extractProjectIdEqValue helper', () => {
      it.each([
        [
          'projectId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3',
          '6f8a2966-e173-11e8-ae74-ffd84c19d7f3',
        ],
        ['projectId:eq:Finance', 'Finance'],
        ['name:eq:X,projectId:eq:abc-123', 'abc-123'],
        ['projectId:eq:abc-123,projectName:eq:Y', 'abc-123'],
      ])('extracts the value from %s', (input, expected) => {
        expect(extractProjectIdEqValue(input)).toBe(expected);
      });

      it.each([undefined, '', 'name:eq:X', 'projectName:eq:Finance'])(
        'returns undefined for filter without projectId:eq clause: %s',
        (input) => {
          expect(extractProjectIdEqValue(input)).toBeUndefined();
        },
      );
    });

    describe('looksLikeUuid heuristic', () => {
      it.each([
        ['6f8a2966-e173-11e8-ae74-ffd84c19d7f3', true],
        ['00000000-0000-0000-0000-000000000000', true],
        ['6F8A2966-E173-11E8-AE74-FFD84C19D7F3', true],
        ['  6f8a2966-e173-11e8-ae74-ffd84c19d7f3  ', true],
        ['Finance', false],
        ['not-a-uuid', false],
        ['default', false],
        ['6f8a2966-e173-11e8-ae74', false],
        ['', false],
      ])('classifies %s correctly (expected=%s)', (input, expected) => {
        expect(looksLikeUuid(input)).toBe(expected);
      });
    });

    it('attaches a recovery hint when projectId:eq:<project-name> returns 0 flows', () => {
      const result = constrainFlows({
        result: { flows: [] },
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
        validatedFilter: 'projectId:eq:Finance',
      });

      invariant(result.type === 'empty');
      expect(result.message).toContain('No flows were found');
      expect(result.message).toContain('Finance');
      expect(result.message).toContain('not a UUID');
      expect(result.message).toContain('projectName:eq:');
      expect(result.message).toContain('Projects REST API');
    });

    it('attaches a recovery hint when projectId:eq:<arbitrary-token> returns 0 flows', () => {
      const result = constrainFlows({
        result: { flows: [] },
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
        validatedFilter: 'projectId:eq:not-a-uuid',
      });

      invariant(result.type === 'empty');
      expect(result.message).toContain('not a UUID');
    });

    it('does NOT attach the projectId hint when value IS a valid UUID (real "no flows" case)', () => {
      const result = constrainFlows({
        result: { flows: [] },
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
        validatedFilter: 'projectId:eq:6f8a2966-e173-11e8-ae74-ffd84c19d7f3',
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No flows were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('prioritises ownerName hint when both projectId and ownerName traps would fire', () => {
      // The ownerName hint is the higher-signal one (more LLMs hit it). When both
      // conditions are met we should surface that one rather than the projectId hint.
      const result = constrainFlows({
        result: { flows: [] },
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        },
        validatedFilter: 'ownerName:eq:jane@example.com,projectId:eq:Finance',
      });

      invariant(result.type === 'empty');
      expect(result.message).toContain('ownerName');
      expect(result.message).toContain('jane@example.com');
      expect(result.message).not.toContain('not a UUID');
    });

    it('integration: tool-call response surfaces the projectId recovery hint when projectId:eq:<name> matches no flows', async () => {
      mocks.mockQueryFlowsForSite.mockResolvedValue({
        pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 0 },
        flows: [],
      });
      const result = await getToolResult({ filter: 'projectId:eq:Finance' });
      expect(result.isError).toBe(false);
      invariant(result.content[0].type === 'text');
      expect(result.content[0].text).toContain('Finance');
      expect(result.content[0].text).toContain('not a UUID');
      expect(result.content[0].text).toContain('projectName:eq:');
    });
  });
});

async function getToolResult(params: { filter: string; sort?: string }): Promise<CallToolResult> {
  const listFlowsTool = getListFlowsTool(new WebMcpServer());
  const callback = await Provider.from(listFlowsTool.callback);
  return await callback(
    { filter: params.filter, sort: params.sort, pageSize: undefined, limit: undefined },
    getMockRequestHandlerExtra(),
  );
}
