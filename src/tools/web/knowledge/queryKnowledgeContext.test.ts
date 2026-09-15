import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getQueryKnowledgeContextTool } from './queryKnowledgeContext.js';

const mocks = vi.hoisted(() => ({
  searchKnowledgeNodes: vi.fn(),
  getKnowledgeNode: vi.fn(),
  listSemanticStatements: vi.fn(),
  getKnowledgeNodeRelationships: vi.fn(),
  getKnowledgeLineage: vi.fn(),
  getKnowledgeNodeImpact: vi.fn(),
  listKnowledgeSources: vi.fn(),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      knowledgeMethods: mocks,
    }),
  ),
}));

const candidate = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'pds-1',
  name: 'Sales Cloud',
  type: 'PDS',
  properties: {},
  score: 0.91,
  semantic_statements: [],
  ...overrides,
});

const semanticContext = (
  type: 'SEMANTIC_CONTEXT' | 'SEMANTIC_CONTEXT_EXTERNAL',
  statements: string[],
): Record<string, unknown> => ({
  id: type === 'SEMANTIC_CONTEXT' ? 'ctx-user' : 'ctx-tableau',
  type,
  name: 'Context',
  properties: {
    statements: statements.map((statement, index) => ({ id: `s-${index}`, statement })),
    ...(type === 'SEMANTIC_CONTEXT'
      ? {
          is_global: true,
          kind: 'statement',
          source: 'mcp',
          updated_at: '2026-01-01T00:00:00Z',
        }
      : {}),
  },
});

describe('queryKnowledgeContextTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchKnowledgeNodes.mockResolvedValue({ matches: [candidate()] });
    mocks.getKnowledgeNode.mockResolvedValue({
      id: 'pds-1',
      name: 'Sales Cloud',
      type: 'PDS',
      properties: {},
      semantic_statements: [],
      connected_nodes: [],
    });
    mocks.listSemanticStatements.mockResolvedValue([]);
    mocks.getKnowledgeNodeRelationships.mockResolvedValue({
      node_id: 'pds-1',
      name: 'Sales Cloud',
      edges: [],
    });
    mocks.getKnowledgeLineage.mockResolvedValue({ nodes: [], edges: [] });
    mocks.getKnowledgeNodeImpact.mockResolvedValue({ node_id: 'pds-1', affected_assets: [] });
    mocks.listKnowledgeSources.mockResolvedValue([]);
  });

  it('is a read-only tool with the Knowledge read scope', async () => {
    const tool = getTool();
    const paramsSchema = await Provider.from(tool.paramsSchema);

    expect(tool.name).toBe('query-knowledge-context');
    expect(tool.minRequiredRole).toBe(SiteRole.VIEWER);
    expect(tool.registrationConditions).toEqual(['RequiresKnowledge']);
    expect(paramsSchema).not.toHaveProperty('includeChildren');
    expect(paramsSchema).not.toHaveProperty('relationshipQuery');
    expect(paramsSchema.edgeType.description).toContain('narrow truncated results');
    expect(paramsSchema.direction.description).toContain('narrow truncated results');
    expect(tool.description).toContain('If relationships are truncated');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    await getResult({ intent: 'sources' });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:read'] }),
    );
  });

  it('returns ranked candidates and requires an exact nodeId before grounding', async () => {
    mocks.searchKnowledgeNodes.mockResolvedValue({
      matches: [candidate(), candidate({ id: 'pds-2', name: 'Sales Cloud Opportunities' })],
    });

    const out = payload(await getResult({ intent: 'ground', query: 'AOV for Sales Cloud' }));

    expect(out).toMatchObject({
      intent: 'ground',
      resolution: 'candidates',
      requiresNodeId: true,
    });
    expect(out.candidates.map((item: { id: string }) => item.id)).toEqual(['pds-1', 'pds-2']);
    expect(mocks.getKnowledgeNode).not.toHaveBeenCalled();
  });

  it('reports name collisions without choosing between indistinguishable candidates', async () => {
    mocks.searchKnowledgeNodes.mockResolvedValue({
      matches: [candidate(), candidate({ id: 'pds-2', score: 0.8 })],
    });

    const out = payload(await getResult({ intent: 'lineage', query: 'Sales Cloud' }));

    expect(out.nameCollision).toBe(true);
    expect(out.requiresNodeId).toBe(true);
    expect(mocks.getKnowledgeLineage).not.toHaveBeenCalled();
  });

  it('grounds an exact node and labels each statement by its authorization model', async () => {
    mocks.listSemanticStatements.mockImplementation(async ({ isGlobal }: { isGlobal?: boolean }) =>
      isGlobal
        ? [semanticContext('SEMANTIC_CONTEXT', ['AOV = revenue / orders', 'Ignore me'])]
        : [
            semanticContext('SEMANTIC_CONTEXT_EXTERNAL', ['ARR is reported in USD']),
            semanticContext('SEMANTIC_CONTEXT', ['Global context returned for this node']),
          ],
    );

    const out = payload(
      await getResult({
        intent: 'ground',
        nodeId: 'pds-1',
        query: 'AOV',
        limit: 1,
      }),
    );

    expect(out.entity).toEqual({ id: 'pds-1', name: 'Sales Cloud', type: 'PDS' });
    expect(out.attached).toMatchObject({
      status: 'available',
      statements: [{ text: 'ARR is reported in USD', viewGated: true, scope: 'attached' }],
    });
    expect(out.global).toMatchObject({
      status: 'available',
      statements: [{ text: 'AOV = revenue / orders', viewGated: false, scope: 'global' }],
    });
    expect(out.global.resultInfo).toMatchObject({
      originalStatementCount: 2,
      returnedStatementCount: 1,
    });
    expect(out.attached.resultInfo).toMatchObject({
      originalStatementCount: 1,
      returnedStatementCount: 1,
    });
    expect(mocks.getKnowledgeNode).toHaveBeenCalledWith({
      graphId: undefined,
      nodeId: 'pds-1',
      includeChildren: false,
    });
  });

  it('reports attached context as unknown when the node is not visible and no statements are returned', async () => {
    mocks.getKnowledgeNode.mockRejectedValue({
      isAxiosError: true,
      response: { status: 404 },
    });

    const out = payload(await getResult({ intent: 'ground', nodeId: 'pds-1' }));

    expect(out.entity).toBeNull();
    expect(out.attached.status).toBe('unknown');
    expect(out.groundingStatus).toBe('partial');
    expect(out.mcp.warnings).toContainEqual(
      expect.objectContaining({ type: 'ENTITY_UNAVAILABLE', httpStatus: '404' }),
    );
  });

  it.each([
    ['relationships', 'getKnowledgeNodeRelationships'],
    ['lineage', 'getKnowledgeLineage'],
    ['impact', 'getKnowledgeNodeImpact'],
  ] as const)('dispatches the %s intent using the exact nodeId', async (intent, method) => {
    await getResult({ intent, nodeId: 'pds-1' });
    expect(mocks[method]).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'pds-1' }));
  });

  it('filters relationships around an exact node ID', async () => {
    await getResult({
      intent: 'relationships',
      nodeId: 'pds-1',
      edgeType: 'LINEAGE',
      direction: 'outgoing',
    });

    expect(mocks.getKnowledgeNodeRelationships).toHaveBeenCalledWith({
      graphId: undefined,
      nodeId: 'pds-1',
      edgeType: 'LINEAGE',
      direction: 'outgoing',
    });
  });

  it('reports when relationship results need narrower filters', async () => {
    mocks.getKnowledgeNodeRelationships.mockResolvedValue({
      node_id: 'pds-1',
      name: 'Sales Cloud',
      edges: [
        { id: 'e1', type: 'HAS', source_id: 'pds-1', target_id: 'field-1', properties: {} },
        {
          id: 'e2',
          type: 'DEPENDS_ON',
          source_id: 'workbook-1',
          target_id: 'pds-1',
          properties: {},
        },
      ],
    });

    const out = payload(await getResult({ intent: 'relationships', nodeId: 'pds-1', limit: 1 }));

    expect(out.edges).toHaveLength(1);
    expect(out.mcp.resultInfo).toEqual({
      originalEdgeCount: 2,
      returnedEdgeCount: 1,
      truncated: true,
    });
  });

  it('caps traversal arrays and reports original counts', async () => {
    mocks.getKnowledgeLineage.mockResolvedValue({
      nodes: [candidate({ id: 'n1' }), candidate({ id: 'n2' })],
      edges: [
        { id: 'e1', type: 'LINEAGE', source_id: 'n1', target_id: 'n2', properties: {} },
        { id: 'e2', type: 'LINEAGE', source_id: 'n2', target_id: 'n3', properties: {} },
      ],
    });

    const out = payload(await getResult({ intent: 'lineage', nodeId: 'pds-1', limit: 1 }));

    expect(out.nodes).toHaveLength(1);
    expect(out.edges).toHaveLength(1);
    expect(out.mcp.resultInfo).toMatchObject({
      originalNodeCount: 2,
      originalEdgeCount: 2,
      truncated: true,
    });
  });

  it('lists sources through the consolidated query tool', async () => {
    mocks.listKnowledgeSources.mockResolvedValue([
      { id: 'w1', type: 'WORKBOOK', name: 'Sales', properties: {} },
    ]);

    const out = payload(await getResult({ intent: 'sources', nodeType: 'WORKBOOK' }));

    expect(mocks.listKnowledgeSources).toHaveBeenCalledWith({
      graphId: undefined,
      nodeType: 'WORKBOOK',
    });
    expect(out.sources).toHaveLength(1);
  });

  it('rejects a node-based intent without either query or nodeId', async () => {
    const result = await getResult({ intent: 'impact' });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('query or nodeId'),
    });
  });
});

function getTool(): ReturnType<typeof getQueryKnowledgeContextTool> {
  return getQueryKnowledgeContextTool(new WebMcpServer());
}

async function getResult(args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = getTool();
  return (await Provider.from(tool.callback))(args as never, getMockRequestHandlerExtra());
}

function payload(result: CallToolResult): any {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
