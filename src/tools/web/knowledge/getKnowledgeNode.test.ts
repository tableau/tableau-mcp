import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { useRestApi } from '../../../restApiInstance.js';
import { WebMcpServer } from '../../../server.web.js';
import invariant from '../../../utils/invariant.js';
import { Provider } from '../../../utils/provider.js';
import { getMockRequestHandlerExtra } from '../toolContext.mock.js';
import { webToolFactories } from '../tools.js';

const mocks = vi.hoisted(() => ({ getKnowledgeNode: vi.fn() }));

vi.mock('../../../restApiInstance.js', () => ({
  useRestApi: vi
    .fn()
    .mockImplementation(async ({ callback }) =>
      callback({ knowledgeMethods: { getKnowledgeNode: mocks.getKnowledgeNode } }),
    ),
}));

const nodeContext = {
  id: 'field-1',
  type: 'FIELD',
  name: 'Net Revenue',
  properties: { formula: '[Sales] - [Tax]' },
  semantic_statements: [{ id: 'stmt-1', statement: 'Revenue excludes tax.' }],
  connected_nodes: [{ id: 'table-1', name: 'Orders', type: 'TABLE', edge_type: 'CONTAINS' }],
};

describe('getKnowledgeNodeTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered with read-only annotations', async () => {
    const tool = getTool();
    expect(tool.name).toBe('get-knowledge-node');
    expect(tool.paramsSchema).toMatchObject({
      graphId: expect.any(Object),
      nodeId: expect.any(Object),
      includeChildren: expect.any(Object),
    });
    expect(tool.description).toContain('by its exact id');
    expect(tool.description).toContain('search-knowledge-nodes');
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('requires a trimmed non-empty nodeId and an optional boolean includeChildren', async () => {
    const schema = await Provider.from(getTool().paramsSchema);
    expect(schema.nodeId.parse('  field-1  ')).toBe('field-1');
    expect(schema.nodeId.safeParse('  ').success).toBe(false);
    expect(schema.includeChildren.safeParse(false).success).toBe(true);
    expect(schema.includeChildren.safeParse(undefined).success).toBe(true);
    expect(schema.includeChildren.safeParse('yes').success).toBe(false);
    // graphId is optional: omitting it targets the site's active/default graph.
    expect(schema.graphId.safeParse(undefined).success).toBe(true);
    expect(schema.graphId.safeParse('graph-1').success).toBe(true);
  });

  it('forwards nodeId, includeChildren, and exact knowledge API scope', async () => {
    mocks.getKnowledgeNode.mockResolvedValue(nodeContext);
    await getJsonResult({ graphId: 'graph-1', nodeId: 'field-1', includeChildren: false });
    expect(mocks.getKnowledgeNode).toHaveBeenCalledWith({
      graphId: 'graph-1',
      nodeId: 'field-1',
      includeChildren: false,
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:read'] }),
    );
  });

  it('returns the fetched node context with statements and connected nodes', async () => {
    mocks.getKnowledgeNode.mockResolvedValue(nodeContext);
    expect(await getJsonResult({ graphId: 'graph-1', nodeId: 'field-1' })).toEqual(nodeContext);
  });
});

function getTool(): any {
  const factory = webToolFactories.find(
    (candidate) => candidate.name === 'getGetKnowledgeNodeTool',
  );
  expect(factory, 'getGetKnowledgeNodeTool is not registered').toBeDefined();
  return (factory as (server: WebMcpServer) => any)(new WebMcpServer());
}

async function getJsonResult(args: any): Promise<unknown> {
  const tool = getTool();
  const result: CallToolResult = await (
    await Provider.from(tool.callback)
  )(args, getMockRequestHandlerExtra());
  expect(result.isError).not.toBe(true);
  invariant(result.content[0].type === 'text');
  return JSON.parse(result.content[0].text);
}
