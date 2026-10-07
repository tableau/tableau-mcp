import {
  objectFromShape,
  safeParse,
  ZodRawShapeCompat,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { advertisedInputSchema } from './knowledgeSchemaTestUtils.js';
import { getManageKnowledgeContextTool, validateArgs } from './manageKnowledgeContext.js';

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  listSemanticStatements: vi.fn(),
  getKnowledgeNode: vi.fn(),
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
    mocks.listSemanticStatements.mockResolvedValue([]);
    mocks.getKnowledgeNode.mockResolvedValue({ id: 'ctx-1' });
    mocks.createSemanticStatements.mockResolvedValue(context());
    mocks.updateSemanticStatements.mockResolvedValue(context(['Updated definition']));
    mocks.deleteSemanticStatements.mockResolvedValue(undefined);
  });

  it('is disabled when the knowledge-tools feature flag is off', async () => {
    mocks.isFeatureEnabled.mockResolvedValue(false);

    expect(await Provider.from(getTool().disabled)).toBe(true);
    expect(mocks.isFeatureEnabled).toHaveBeenCalledWith('knowledge-tools');
  });

  it('advertises a non-empty inputSchema carrying the action enum', async () => {
    // Reproduces the MCP SDK's own schema-advertisement conversion (see
    // knowledgeSchemaTestUtils.ts). A z.discriminatedUnion (this tool's schema before the fix)
    // converts to `{"type":"object","properties":{}}` because it has no top-level `.shape`; the
    // flat raw shape this tool now uses does not have that problem.
    const paramsSchema = await Provider.from(getTool().paramsSchema);
    const jsonSchema = advertisedInputSchema(paramsSchema as ZodRawShapeCompat);
    const properties = jsonSchema.properties as Record<string, { enum?: unknown }> | undefined;

    expect(properties).toBeTruthy();
    expect(Object.keys(properties ?? {}).length).toBeGreaterThan(0);
    expect(properties?.action?.enum).toEqual(['create', 'update', 'delete']);
  });

  it('enforces the one-to-100 statement array bound at the schema level', async () => {
    const paramsSchema = await Provider.from(getTool().paramsSchema);
    const objectSchema = objectFromShape(paramsSchema as ZodRawShapeCompat);

    expect(
      safeParse(objectSchema, { action: 'create', statements: [], isGlobal: true }).success,
    ).toBe(false);
    expect(
      safeParse(objectSchema, {
        action: 'create',
        statements: [{ statement: 'AOV = revenue / orders' }],
        isGlobal: true,
      }).success,
    ).toBe(true);
  });

  it('rejects params irrelevant to, or missing for, the chosen mutation action', () => {
    expect(validateArgs({ action: 'delete', contextId: 'ctx-1' })).toBeNull();
    expect(validateArgs({ action: 'delete' })).toMatch(
      /contextId is required when action is "delete"/,
    );
    expect(
      validateArgs({ action: 'delete', contextId: 'ctx-1', statements: [{ statement: 'x' }] }),
    ).toMatch(/statements is not used when action is "delete"/);
    expect(
      validateArgs({
        action: 'create',
        statements: [{ statement: 'AOV = revenue / orders' }],
        isGlobal: true,
      }),
    ).toBeNull();
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
    const result = await getResult({ action: 'create', isGlobal: true });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('statements is required when action is "create"');
    expect(mocks.createSemanticStatements).not.toHaveBeenCalled();
  });

  it('does not create a statement that already exists in the same scope', async () => {
    mocks.listSemanticStatements.mockResolvedValue([context()]);

    const out = payload(
      await getResult({
        action: 'create',
        isGlobal: true,
        statements: [{ statement: '  aov = revenue / orders ' }],
      }),
    );

    expect(mocks.createSemanticStatements).not.toHaveBeenCalled();
    expect(out).toMatchObject({ created: false, reason: 'DUPLICATE', existingContextId: 'ctx-1' });
  });

  it('reports NOT_FOUND instead of deleting an unknown contextId', async () => {
    mocks.getKnowledgeNode.mockRejectedValue({ isAxiosError: true, response: { status: 404 } });
    const out = payload(
      await getResult({ action: 'delete', graphId: 'graph-1', contextId: 'missing' }),
    );

    expect(mocks.deleteSemanticStatements).not.toHaveBeenCalled();
    expect(out).toMatchObject({ deleted: false, reason: 'NOT_FOUND', contextId: 'missing' });
  });

  it('does not report NOT_FOUND when the lookup fails for another reason', async () => {
    mocks.getKnowledgeNode.mockRejectedValue({ isAxiosError: true, response: { status: 500 } });

    const result = await getResult({ action: 'delete', graphId: 'graph-1', contextId: 'ctx-1' });

    expect(result.isError).toBe(true);
    expect(mocks.deleteSemanticStatements).not.toHaveBeenCalled();
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
      deleted: true,
    });
  });

  it('rejects delete without contextId', async () => {
    const result = await getResult({ action: 'delete' });

    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('contextId is required when action is "delete"');
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

function payload(result: CallToolResult): any {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
