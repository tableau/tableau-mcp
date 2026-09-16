import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getManageKnowledgeContextTool } from './manageKnowledgeContext.js';

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  listGraphs: vi.fn(),
  listSemanticStatements: vi.fn(),
  getKnowledgeSuggestions: vi.fn(),
  createSemanticStatements: vi.fn(),
  updateSemanticStatements: vi.fn(),
  deleteSemanticStatements: vi.fn(),
}));

vi.mock('../../../features/init.js', () => ({
  getFeatureGate: vi.fn(() => ({ isFeatureEnabled: mocks.isFeatureEnabled })),
}));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      knowledgeMethods: mocks,
    }),
  ),
}));

const context = (statements = ['AOV = revenue / orders']): Record<string, unknown> => ({
  id: 'ctx-1',
  type: 'SEMANTIC_CONTEXT',
  name: 'Revenue rules',
  target_node_id: null,
  properties: {
    statements: statements.map((statement, index) => ({ id: `s-${index}`, statement })),
    is_global: true,
    kind: 'statement',
    source: 'mcp',
    updated_at: '2026-01-01T00:00:00Z',
  },
});

describe('manageKnowledgeContextTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isFeatureEnabled.mockResolvedValue(true);
    mocks.listGraphs.mockResolvedValue([]);
    mocks.listSemanticStatements.mockResolvedValue([]);
    mocks.getKnowledgeSuggestions.mockResolvedValue({
      health_score: 95,
      stats: {
        total_nodes: 10,
        total_relationships: 9,
        connected_sources: 2,
        workbooks: 3,
      },
      metrics: [],
      suggestions: [],
      categories: [],
      topics: [],
      summary: {
        total: 0,
        by_severity: {},
        by_type: {},
        by_category: {},
        by_topic: {},
        errors: 0,
      },
      errors: [],
    });
    mocks.createSemanticStatements.mockResolvedValue(context());
    mocks.updateSemanticStatements.mockResolvedValue(context(['Updated definition']));
    mocks.deleteSemanticStatements.mockResolvedValue(undefined);
  });

  it('is disabled when the knowledge-tools feature flag is off', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);

    expect(await Provider.from(getTool().disabled)).toBe(true);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('knowledge-tools');
  });

  it('uses conservative mutation annotations and requires both Knowledge scopes', async () => {
    const tool = getTool();

    expect(tool.name).toBe('manage-knowledge-context');
    expect(tool.minRequiredRole).toBe(SiteRole.CREATOR);
    expect(tool.registrationConditions).toEqual(['RequiresKnowledge']);
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });

    await getResult({ action: 'status' });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({
        jwtScopes: ['tableau:knowledge:read', 'tableau:knowledge:write'],
      }),
    );
  });

  it('reports graph status from graph discovery', async () => {
    mocks.listGraphs.mockResolvedValue([
      {
        id: 'g1',
        name: 'Primary',
        description: 'Main graph',
        status: 'active',
        is_primary: true,
        created_at: null,
        updated_at: null,
      },
    ]);

    const out = payload(await getResult({ action: 'status' }));

    expect(out.action).toBe('status');
    expect(out.graphs).toHaveLength(1);
    expect(out.primaryGraph.id).toBe('g1');
  });

  it('lists semantic contexts while capping flattened statements', async () => {
    mocks.listSemanticStatements.mockResolvedValue([context(['First', 'Second'])]);

    const out = payload(await getResult({ action: 'list', isGlobal: true, limit: 1 }));

    expect(mocks.listSemanticStatements).toHaveBeenCalledWith({
      graphId: undefined,
      nodeId: undefined,
      isGlobal: true,
    });
    expect(out.statements).toHaveLength(1);
    expect(out.resultInfo).toMatchObject({
      originalStatementCount: 2,
      returnedStatementCount: 1,
      truncated: true,
    });
  });

  it('returns a compact suggestions report without duplicating category and topic trees', async () => {
    mocks.getKnowledgeSuggestions.mockResolvedValue({
      health_score: 72,
      stats: {
        total_nodes: 10,
        total_relationships: 4,
        connected_sources: 1,
        workbooks: 2,
      },
      metrics: [],
      suggestions: [
        {
          id: 'sg-1',
          type: 'coverage',
          category: 'context',
          topic: 'definitions',
          title: 'Add definitions',
          detail: 'Missing definitions',
          recommended_action: 'Add context',
          severity: 'medium',
          target_ids: ['pds-1'],
          metadata: {},
        },
      ],
      categories: [{ category: 'context', count: 1, severity: 'medium', suggestions: [] }],
      topics: [],
      summary: {
        total: 1,
        by_severity: { medium: 1 },
        by_type: { coverage: 1 },
        by_category: { context: 1 },
        by_topic: { definitions: 1 },
        errors: 0,
      },
      errors: [],
    });

    const out = payload(await getResult({ action: 'suggestions' }));

    expect(out.healthScore).toBe(72);
    expect(out.suggestions).toHaveLength(1);
    expect(out).not.toHaveProperty('categories');
    expect(out).not.toHaveProperty('topics');
  });

  it('creates a global customer-governed context', async () => {
    const statements = [{ statement: 'AOV = revenue / orders' }];

    const out = payload(
      await getResult({ action: 'create', statements, isGlobal: true, name: 'AOV' }),
    );

    expect(mocks.createSemanticStatements).toHaveBeenCalledWith({
      graphId: undefined,
      statements,
      targetNodeId: undefined,
      isGlobal: true,
      name: 'AOV',
    });
    expect(out.context.id).toBe('ctx-1');
  });

  it('updates a context by exact contextId', async () => {
    const statements = [{ id: 's-0', statement: 'Updated definition' }];

    await getResult({ action: 'update', contextId: 'ctx-1', statements });

    expect(mocks.updateSemanticStatements).toHaveBeenCalledWith({
      graphId: undefined,
      contextId: 'ctx-1',
      statements,
      targetNodeId: undefined,
      isGlobal: undefined,
      name: undefined,
    });
  });

  it('rejects create without statements', async () => {
    const result = await getResult({ action: 'create', isGlobal: true });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('statements'),
    });
    expect(mocks.createSemanticStatements).not.toHaveBeenCalled();
  });

  it('deletes a context by exact contextId without overstating the result', async () => {
    const actionSchema = (await Provider.from(getTool().paramsSchema)).action;
    expect(actionSchema.safeParse('delete').success).toBe(true);

    const out = payload(
      await getResult({ action: 'delete', graphId: 'graph-1', contextId: 'ctx-1' }),
    );

    expect(mocks.deleteSemanticStatements).toHaveBeenCalledWith({
      graphId: 'graph-1',
      contextId: 'ctx-1',
    });
    expect(out).toEqual({
      action: 'delete',
      contextId: 'ctx-1',
      requestCompleted: true,
    });
  });

  it('rejects delete without contextId', async () => {
    const result = await getResult({ action: 'delete' });

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('contextId'),
    });
    expect(mocks.deleteSemanticStatements).not.toHaveBeenCalled();
  });

  it('derives global scope when listing mixed contexts', async () => {
    mocks.listSemanticStatements.mockResolvedValue([context()]);

    const out = payload(await getResult({ action: 'list' }));

    expect(out.statements[0].scope).toBe('global');
  });

  it('preserves global scope when a node listing includes applicable global context', async () => {
    mocks.listSemanticStatements.mockResolvedValue([context()]);

    const out = payload(await getResult({ action: 'list', nodeId: 'pds-1' }));

    expect(out.statements[0].scope).toBe('global');
  });
});

function getTool(): ReturnType<typeof getManageKnowledgeContextTool> {
  return getManageKnowledgeContextTool(new WebMcpServer());
}

async function getResult(args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = getTool();
  return (await Provider.from(tool.callback))(args as never, getMockRequestHandlerExtra());
}

function payload(result: CallToolResult): any {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
