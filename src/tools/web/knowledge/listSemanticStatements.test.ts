import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';

const mocks = vi.hoisted(() => ({ listSemanticStatements: vi.fn() }));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi
    .fn()
    .mockImplementation(async ({ callback }) =>
      callback({ knowledgeMethods: { listSemanticStatements: mocks.listSemanticStatements } }),
    ),
}));

describe('listSemanticStatementsTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered as read-only and does not expose ignored backend filters', async () => {
    const tool = getTool();
    expect(tool.name).toBe('list-knowledge-semantic-contexts');
    expect(tool.paramsSchema).toMatchObject({
      graphId: expect.any(Object),
      nodeId: expect.any(Object),
      isGlobal: expect.any(Object),
    });
    expect(tool.paramsSchema).not.toHaveProperty('query');
    expect(tool.paramsSchema).not.toHaveProperty('kind');
    expect(tool.paramsSchema).not.toHaveProperty('limit');
    expect(tool.description).toContain('Fallback-only');
    expect(tool.description).toContain('returned no attached statement');
    expect(tool.description).toContain('Never call it for a node');
    expect(tool.description).toContain('add latency');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const schema = await Provider.from(tool.paramsSchema);
    expect(schema.nodeId.safeParse('field/Revenue').success).toBe(false);
  });

  it('rejects nodeId with isGlobal because node search always unions attached and global', async () => {
    const result = await getToolResult({
      graphId: 'graph-1',
      nodeId: 'field:Revenue',
      isGlobal: true,
    });
    expect(result.isError).toBe(true);
    expect(mocks.listSemanticStatements).not.toHaveBeenCalled();
  });

  it('dispatches node and graph searches with read scope', async () => {
    mocks.listSemanticStatements.mockResolvedValue([]);
    await getToolResult({ graphId: 'graph-1', nodeId: 'field:Revenue' });
    await getToolResult({ graphId: 'graph-1', isGlobal: false });
    expect(mocks.listSemanticStatements).toHaveBeenNthCalledWith(1, {
      graphId: 'graph-1',
      nodeId: 'field:Revenue',
    });
    expect(mocks.listSemanticStatements).toHaveBeenNthCalledWith(2, {
      graphId: 'graph-1',
      isGlobal: false,
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:read'] }),
    );
  });

  it('applies configured truncation and returns completeness metadata', async () => {
    mocks.listSemanticStatements.mockResolvedValue([
      { id: 'semctx:1' },
      { id: 'semctx:2' },
      { id: 'semctx:3' },
    ]);
    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '2' }));
    const result = await getToolResult({ graphId: 'graph-1' }, extra);
    expect(result.isError).toBe(false);
    const content = result.content[0];
    expect(content.type).toBe('text');
    if (content.type === 'text') {
      expect(JSON.parse(content.text)).toEqual({
        semanticStatements: [{ id: 'semctx:1' }, { id: 'semctx:2' }],
        mcp: { resultInfo: { returnedCount: 2, totalAvailable: 3, truncated: true } },
      });
    }
  });
});

function getTool(): any {
  const factory = webToolFactories.find(
    (candidate) => candidate.name === 'getListSemanticStatementsTool',
  );
  expect(factory, 'getListSemanticStatementsTool is not registered').toBeDefined();
  return (factory as (server: WebMcpServer) => any)(new WebMcpServer());
}

async function getToolResult(
  args: any,
  extra = getMockRequestHandlerExtra(),
): Promise<CallToolResult> {
  const tool = getTool();
  return (await Provider.from(tool.callback))(args, extra);
}
