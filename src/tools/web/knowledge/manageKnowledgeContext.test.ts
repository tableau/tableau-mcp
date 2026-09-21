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
    mocks.createSemanticStatements.mockResolvedValue(context());
    mocks.updateSemanticStatements.mockResolvedValue(context(['Updated definition']));
    mocks.deleteSemanticStatements.mockResolvedValue(undefined);
  });

  it('is disabled when the knowledge-tools feature flag is off', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);

    expect(await Provider.from(getTool().disabled)).toBe(true);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('knowledge-tools');
  });

  it('exposes only mutation parameters', async () => {
    const schema = await Provider.from(getTool().paramsSchema);
    expect(schema).toHaveProperty('safeParse', expect.any(Function));
    if (!('safeParse' in schema)) return;

    expect(schema.safeParse({ action: 'delete', contextId: 'ctx-1' }).success).toBe(true);
    expect(schema.safeParse({ action: 'delete' }).success).toBe(false);
    expect(schema.safeParse({ action: 'delete', contextId: 'ctx-1', statements: [] }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({
        action: 'create',
        statements: [{ statement: 'AOV = revenue / orders' }],
        isGlobal: true,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ action: 'create', statements: [] }).success).toBe(false);
    expect(schema.safeParse({ action: 'status' }).success).toBe(false);
  });

  it('uses mutation annotations and requires only the Knowledge write scope', async () => {
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

    await getResult({
      action: 'create',
      statements: [{ statement: 'AOV = revenue / orders' }],
      isGlobal: true,
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({
        jwtScopes: ['tableau:knowledge:write'],
      }),
    );
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
    const result = await parseParams({ action: 'create', isGlobal: true });

    expect(result.success).toBe(false);
    expect(mocks.createSemanticStatements).not.toHaveBeenCalled();
  });

  it('deletes a context by exact contextId without overstating the result', async () => {
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
    const result = await parseParams({ action: 'delete' });

    expect(result.success).toBe(false);
    expect(mocks.deleteSemanticStatements).not.toHaveBeenCalled();
  });
});

function getTool(): ReturnType<typeof getManageKnowledgeContextTool> {
  return getManageKnowledgeContextTool(new WebMcpServer());
}

async function getResult(args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = getTool();
  return (await Provider.from(tool.callback))(args as never, getMockRequestHandlerExtra());
}

async function parseParams(args: Record<string, unknown>): Promise<{ success: boolean }> {
  const schema = await Provider.from(getTool().paramsSchema);
  invariant('safeParse' in schema);
  return schema.safeParse(args);
}

function payload(result: CallToolResult): any {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
