import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';

const mocks = vi.hoisted(() => ({ searchKnowledgeNodes: vi.fn() }));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi
    .fn()
    .mockImplementation(async ({ callback }) =>
      callback({ knowledgeMethods: { searchKnowledgeNodes: mocks.searchKnowledgeNodes } }),
    ),
}));

describe('searchKnowledgeNodesTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered with validated filters and read-only annotations', async () => {
    const tool = getTool();
    expect(tool.name).toBe('search-knowledge-nodes');
    expect(tool.paramsSchema).toMatchObject({
      graphId: expect.any(Object),
      query: expect.any(Object),
      nodeType: expect.any(Object),
      scopeId: expect.any(Object),
      limit: expect.any(Object),
    });
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('trims a non-empty query and accepts optional node and scope filters', async () => {
    const schema = await Provider.from(getTool().paramsSchema);
    expect(schema.query.parse('  net revenue  ')).toBe('net revenue');
    expect(schema.query.safeParse('   ').success).toBe(false);
    expect(schema.nodeType.safeParse('SEMANTIC_CONTEXT').success).toBe(true);
    expect(schema.scopeId.safeParse('pds-1').success).toBe(true);
  });

  it.each(['graph/1', 'graph?1', '.', '..', '', 'a'.repeat(129)])(
    'rejects invalid graph ID %s',
    async (graphId) => {
      const schema = await Provider.from(getTool().paramsSchema);
      expect(schema.graphId.safeParse(graphId).success).toBe(false);
    },
  );

  it.each([0, 101, 1.5])('rejects invalid limit %s', async (limit) => {
    const schema = await Provider.from(getTool().paramsSchema);
    expect(schema.limit.safeParse(limit).success).toBe(false);
  });

  it('uses the default limit of 24 and exact knowledge API scope', async () => {
    await getToolResult({ graphId: 'graph-1', query: 'revenue' });
    expect(mocks.searchKnowledgeNodes).toHaveBeenCalledWith({
      graphId: 'graph-1',
      query: 'revenue',
      limit: 24,
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:read'] }),
    );
  });

  it('forwards a caller limit and optional filters', async () => {
    await getToolResult({
      graphId: 'graph-1',
      query: 'revenue',
      nodeType: 'FIELD',
      scopeId: 'pds-1',
      limit: 40,
    });
    expect(mocks.searchKnowledgeNodes).toHaveBeenCalledWith({
      graphId: 'graph-1',
      query: 'revenue',
      nodeType: 'FIELD',
      scopeId: 'pds-1',
      limit: 40,
    });
  });

  it('clamps the limit through config', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '10' }));
    await getToolResult({ graphId: 'graph-1', query: 'revenue', limit: 40 }, extra);
    expect(mocks.searchKnowledgeNodes).toHaveBeenCalledWith({
      graphId: 'graph-1',
      query: 'revenue',
      limit: 10,
    });
  });

  it('enforces the hard 100 cap when config is higher', async () => {
    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '1000' }));
    await getToolResult({ graphId: 'graph-1', query: 'revenue', limit: 100 }, extra);
    expect(mocks.searchKnowledgeNodes).toHaveBeenCalledWith({
      graphId: 'graph-1',
      query: 'revenue',
      limit: 100,
    });
  });
});

function getTool(): any {
  const factory = webToolFactories.find(
    (candidate) => candidate.name === 'getSearchKnowledgeNodesTool',
  );
  expect(factory, 'getSearchKnowledgeNodesTool is not registered').toBeDefined();
  return (factory as (server: WebMcpServer) => any)(new WebMcpServer());
}

async function getToolResult(
  args: any,
  extra = getMockRequestHandlerExtra(),
): Promise<CallToolResult> {
  mocks.searchKnowledgeNodes.mockResolvedValue({ matches: [] });
  const tool = getTool();
  return (await Provider.from(tool.callback))(args, extra);
}
