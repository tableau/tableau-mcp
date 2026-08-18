import { OverridableConfig } from '../../../overridableConfig.js';
import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';

const mocks = vi.hoisted(() => ({ getKnowledgeNodeImpact: vi.fn() }));
vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi
    .fn()
    .mockImplementation(async ({ callback }) =>
      callback({ knowledgeMethods: { getKnowledgeNodeImpact: mocks.getKnowledgeNodeImpact } }),
    ),
}));

describe('getKnowledgeNodeImpactTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('registers read-only and truncates affected assets with explicit counts', async () => {
    mocks.getKnowledgeNodeImpact.mockResolvedValue({
      node_id: 'field:Sales',
      affected_assets: [{ id: 'a1' }, { id: 'a2' }],
    });
    const extra = getMockRequestHandlerExtra();
    extra.getConfigWithOverrides = vi
      .fn()
      .mockResolvedValue(new OverridableConfig({ MAX_RESULT_LIMIT: '1' }));
    const tool = getTool();
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(await getJsonResult({ graphId: 'graph-1', nodeId: 'field:Sales' }, extra)).toEqual({
      node_id: 'field:Sales',
      affected_assets: [{ id: 'a1' }],
      mcp: {
        resultInfo: {
          truncated: true,
          returnedAffectedCount: 1,
          originalAffectedCount: 2,
        },
      },
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:read'] }),
    );
  });

  it('lets backend errors flow through the normal tool error path', async () => {
    mocks.getKnowledgeNodeImpact.mockRejectedValue(new Error('node not found'));
    const result = await (
      await Provider.from(getTool().callback)
    )({ graphId: 'graph-1', nodeId: 'missing' }, getMockRequestHandlerExtra());
    expect(result.isError).toBe(true);
    invariant(result.content[0].type === 'text');
    expect(result.content[0].text).toContain('node not found');
  });

  it('rejects node IDs containing a path separator', async () => {
    const schema = await Provider.from(getTool().paramsSchema);
    expect(schema.nodeId.safeParse('field/Profit').success).toBe(false);
  });
});

function getTool(): any {
  const factory = webToolFactories.find(
    (candidate) => candidate.name === 'getGetKnowledgeNodeImpactTool',
  );
  expect(factory, 'getGetKnowledgeNodeImpactTool is not registered').toBeDefined();
  return (factory as (server: WebMcpServer) => any)(new WebMcpServer());
}
async function getJsonResult(args: any, extra = getMockRequestHandlerExtra()): Promise<any> {
  const result = await (await Provider.from(getTool().callback))(args, extra);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
