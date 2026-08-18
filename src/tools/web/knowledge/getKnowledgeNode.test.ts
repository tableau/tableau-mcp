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

describe('getKnowledgeNodeTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('is registered with read-only annotations', async () => {
    const tool = getTool();
    expect(tool.name).toBe('get-knowledge-node');
    expect(tool.paramsSchema).toMatchObject({
      graphId: expect.any(Object),
      query: expect.any(Object),
      nodeType: expect.any(Object),
      scopeId: expect.any(Object),
      maxCandidates: expect.any(Object),
    });
    expect(await Provider.from(tool.annotations)).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it('requires a trimmed non-empty query and maxCandidates from 1 through 25', async () => {
    const schema = await Provider.from(getTool().paramsSchema);
    expect(schema.query.parse('  net revenue  ')).toBe('net revenue');
    expect(schema.query.safeParse('  ').success).toBe(false);
    expect(schema.maxCandidates.safeParse(1).success).toBe(true);
    expect(schema.maxCandidates.safeParse(25).success).toBe(true);
    expect(schema.maxCandidates.safeParse(0).success).toBe(false);
    expect(schema.maxCandidates.safeParse(26).success).toBe(false);
    expect(schema.maxCandidates.safeParse(1.5).success).toBe(false);
  });

  it('forwards filters, maxCandidates, and exact knowledge API scope', async () => {
    mocks.getKnowledgeNode.mockResolvedValue({
      needs_disambiguation: true,
      node: null,
      candidates: [],
    });
    await getJsonResult({
      graphId: 'graph-1',
      query: 'revenue',
      nodeType: 'FIELD',
      scopeId: 'pds-1',
      maxCandidates: 7,
    });
    expect(mocks.getKnowledgeNode).toHaveBeenCalledWith({
      graphId: 'graph-1',
      query: 'revenue',
      nodeType: 'FIELD',
      scopeId: 'pds-1',
      maxCandidates: 7,
    });
    expect(vi.mocked(useRestApi)).toHaveBeenCalledWith(
      expect.objectContaining({ jwtScopes: ['tableau:knowledge:read'] }),
    );
  });

  it('preserves the confident full-node response branch', async () => {
    const response = {
      needs_disambiguation: false,
      node: {
        id: 'field-1',
        type: 'FIELD',
        name: 'Revenue',
        properties: {},
        score: 0.9,
      },
    };
    mocks.getKnowledgeNode.mockResolvedValue(response);
    expect(await getJsonResult({ graphId: 'graph-1', query: 'revenue' })).toEqual(response);
  });

  it('preserves the sparse candidate response branch', async () => {
    const response = {
      needs_disambiguation: true,
      node: null,
      candidates: [
        {
          id: 'field-1',
          name: 'Revenue',
          type: 'FIELD',
          score: 0.5,
          certified: null,
        },
      ],
    };
    mocks.getKnowledgeNode.mockResolvedValue(response);
    expect(await getJsonResult({ graphId: 'graph-1', query: 'revenue' })).toEqual(response);
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
