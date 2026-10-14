import { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useRestApi } from '../../../restApiInstance.js';
import { SiteRole } from '../../../sdks/tableau/types/user.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { getInspectKnowledgeContextTool, validateInspectArgs } from './inspectKnowledgeContext.js';
import { advertisedInputSchema } from './knowledgeSchemaTestUtils.js';

const mocks = vi.hoisted(() => ({
  isFeatureEnabled: vi.fn(),
  listGraphs: vi.fn(),
  listSemanticStatements: vi.fn(),
  getKnowledgeSuggestions: vi.fn(),
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

describe('inspectKnowledgeContextTool', () => {
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
    expect(properties?.action?.enum).toEqual(['status', 'list', 'suggestions']);
  });

  it('rejects params irrelevant to the chosen inspection action', () => {
    expect(validateInspectArgs({ action: 'status' })).toBeNull();
    expect(validateInspectArgs({ action: 'list', isGlobal: true })).toBeNull();
    expect(validateInspectArgs({ action: 'suggestions', severity: 'high' })).toBeNull();
    expect(validateInspectArgs({ action: 'status', isGlobal: true })).toMatch(
      /isGlobal is not used when action is "status"/,
    );
    expect(validateInspectArgs({ action: 'list', pdsId: 'pds-1' })).toMatch(
      /pdsId is not used when action is "list"/,
    );
  });

  it('is read-only for every authenticated site role', async () => {
    const tool = getTool();

    expect(tool.name).toBe('inspect-knowledge-context');
    expect(tool.minRequiredRole).toBe(SiteRole.VIEWER);
    expect(tool.registrationConditions).toEqual(['RequiresKnowledge']);
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    await getResult({ action: 'status' });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({
        jwtScopes: ['tableau:knowledge:read'],
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

  it('preserves global scope for graph-wide and node listings', async () => {
    mocks.listSemanticStatements.mockResolvedValue([context()]);

    const graphWide = payload(await getResult({ action: 'list' }));
    const node = payload(await getResult({ action: 'list', nodeId: 'pds-1' }));

    expect(graphWide.statements[0].scope).toBe('global');
    expect(node.statements[0].scope).toBe('global');
  });
});

function getTool(): ReturnType<typeof getInspectKnowledgeContextTool> {
  return getInspectKnowledgeContextTool(new WebMcpServer());
}

async function getResult(args: Record<string, unknown>): Promise<CallToolResult> {
  const tool = getTool();
  return (await Provider.from(tool.callback))(args as never, getMockRequestHandlerExtra());
}

function payload(result: CallToolResult): any {
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
