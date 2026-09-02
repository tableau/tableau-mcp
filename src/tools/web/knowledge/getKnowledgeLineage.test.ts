import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';

const mocks = vi.hoisted(() => ({ getKnowledgeLineage: vi.fn() }));
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi
    .fn()
    .mockImplementation(async ({ callback }) =>
      callback({ knowledgeMethods: { getKnowledgeLineage: mocks.getKnowledgeLineage } }),
    ),
}));

describe('getKnowledgeLineageTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers read-only inputs and returns a missing node as a successful empty traversal', async () => {
    mocks.getKnowledgeLineage.mockResolvedValue({ nodes: [], edges: [] });
    const tool = getTool();
    expect(tool.name).toBe('get-knowledge-lineage');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(await getJsonResult({ graphId: 'graph-1', nodeId: 'missing' })).toEqual({
      nodes: [],
      edges: [],
      mcp: {
        resultInfo: {
          truncated: false,
          returnedNodeCount: 0,
          originalNodeCount: 0,
          returnedEdgeCount: 0,
          originalEdgeCount: 0,
        },
      },
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:read'] }),
    );
  });

  it('truncates nodes and edges consistently at the configured cap', async () => {
    mocks.getKnowledgeLineage.mockResolvedValue({
      nodes: [{ id: 'n2' }, { id: 'n1' }],
      edges: [
        { id: 'e1', source_id: 'n1', target_id: 'n1' },
        { id: 'e2', source_id: 'n1', target_id: 'n2' },
      ],
    });
    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '1' }));
    expect(await getJsonResult({ graphId: 'graph-1', nodeId: 'n1' }, extra)).toEqual({
      nodes: [{ id: 'n1' }],
      edges: [{ id: 'e1', source_id: 'n1', target_id: 'n1' }],
      mcp: {
        resultInfo: {
          truncated: true,
          returnedNodeCount: 1,
          originalNodeCount: 2,
          returnedEdgeCount: 1,
          originalEdgeCount: 2,
        },
      },
    });
  });

  it('rejects node IDs containing a path separator', async () => {
    const schema = await Provider.from(getTool().paramsSchema);
    expect(schema.nodeId.safeParse('field/Profit').success).toBe(false);
  });
});

function getTool(): any {
  const factory = webToolFactories.find(
    (candidate) => candidate.name === 'getGetKnowledgeLineageTool',
  );
  expect(factory, 'getGetKnowledgeLineageTool is not registered').toBeDefined();
  return (factory as (server: WebMcpServer) => any)(new WebMcpServer());
}
async function getJsonResult(args: any, extra = getMockRequestHandlerExtra()): Promise<any> {
  const result = await (await Provider.from(getTool().callback))(args, extra);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
