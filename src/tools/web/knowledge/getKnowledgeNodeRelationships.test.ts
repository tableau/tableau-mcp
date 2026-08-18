import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';

const mocks = vi.hoisted(() => ({ getKnowledgeNodeRelationships: vi.fn() }));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      knowledgeMethods: { getKnowledgeNodeRelationships: mocks.getKnowledgeNodeRelationships },
    }),
  ),
}));

describe('getKnowledgeNodeRelationshipsTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered as read-only and requires at least one anchor', async () => {
    const tool = getTool();
    expect(tool.name).toBe('get-knowledge-node-relationships');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(tool.paramsSchema).toMatchObject({
      graphId: expect.any(Object),
      nodeId: expect.any(Object),
      query: expect.any(Object),
    });
    const callback = await Provider.from(tool.callback);
    const result = await callback({ graphId: 'graph-1' }, getMockRequestHandlerExtra());
    expect(result.isError).toBe(true);
    expect(mocks.getKnowledgeNodeRelationships).not.toHaveBeenCalled();
  });

  it('allows nodeId with a fallback query', async () => {
    mocks.getKnowledgeNodeRelationships.mockResolvedValue({
      node_id: 'field:Sales',
      name: 'Sales',
      edges: [],
    });
    await getJsonResult({ graphId: 'graph-1', nodeId: 'field:Sales', query: 'sales' });
    expect(mocks.getKnowledgeNodeRelationships).toHaveBeenCalledWith({
      graphId: 'graph-1',
      nodeId: 'field:Sales',
      query: 'sales',
    });
  });

  it('clamps the model-facing edge result and reports counts', async () => {
    mocks.getKnowledgeNodeRelationships.mockResolvedValue({
      node_id: 'field:Sales',
      name: 'Sales',
      edges: [{ id: '1' }, { id: '2' }, { id: '3' }],
    });
    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '2' }));
    const result = await getJsonResult(
      {
        graphId: 'graph-1',
        query: 'sales',
        edgeType: 'DEPENDS_ON',
        direction: 'incoming',
        limit: 50,
      },
      extra,
    );
    expect(mocks.getKnowledgeNodeRelationships).toHaveBeenCalledWith({
      graphId: 'graph-1',
      query: 'sales',
      edgeType: 'DEPENDS_ON',
      direction: 'incoming',
      limit: 50,
    });
    expect(result).toMatchObject({
      edges: [{ id: '1' }, { id: '2' }],
      mcp: { resultInfo: { truncated: true, returnedEdgeCount: 2, originalEdgeCount: 3 } },
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:read'] }),
    );
  });
});

function getTool(): any {
  const factory = webToolFactories.find(
    (candidate) => candidate.name === 'getGetKnowledgeNodeRelationshipsTool',
  );
  expect(factory, 'getGetKnowledgeNodeRelationshipsTool is not registered').toBeDefined();
  return (factory as (server: WebMcpServer) => any)(new WebMcpServer());
}

async function getJsonResult(args: any, extra = getMockRequestHandlerExtra()): Promise<any> {
  const result = await (await Provider.from(getTool().callback))(args, extra);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
